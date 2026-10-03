/**
 * fighterWavesSim.cjs — 舰载机波次裁决层回归台架（[v68] 阶段 B）
 *
 * 纪律：require 真源码 .ts，零手抄常量；断言打行为不测实现。
 * 运行：node --import ./_ts_resolve.mjs scripts/fighterWavesSim.cjs
 */
const F = require('../frontend/src/game/fighterWaves.ts');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  process.stdout.write(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}\n`);
  if (condition) passed++; else failed++;
}

/** 建一个满编待放编队 */
function mk(id = 'g1', capacity = F.FIGHTER_CAPACITY) {
  return F.createFighterGroup(id, 1, 'empire', capacity);
}
/** 常规格斗态势 */
const ENGAGE = { ratio: 1.0, lossRate: 0.0, carrierAlive: true, carrierDisengaged: false, hasTarget: true };

console.log('\n=== A. 搭载量与分批放飞 ===');
check('空母按 count 满搭载', F.fighterCapacityFor('空母', 1) === F.FIGHTER_CAPACITY);
check('突击（CV）搭载量少于空母', F.fighterCapacityFor('突击', 1) < F.fighterCapacityFor('空母', 1));
check('非母舰零搭载（战列不产舰载机）', F.fighterCapacityFor('战列', 3) === 0);
check('空母数 2 ⇒ 搭载量翻倍', F.fighterCapacityFor('空母', 2) === F.FIGHTER_CAPACITY * 2);

{
  const g = mk();
  check('新建编队为待放飞态', g.phase === 'stowed' && g.alive === 0 && g.pending === g.capacity);
  const b1 = F.launchBatch(g);
  const b2 = F.launchBatch(g);
  check('分批放飞：第一批 < 满编', b1 < g.capacity, `${b1} / ${g.capacity}`);
  check('分批放飞：批间间隔 > 0', F.FIGHTER_LAUNCH_INTERVAL > 0);
  check('分批放飞：仍为 launching（有剩余）', g.phase === 'launching', g.phase);
  const b3 = F.launchBatch(g);
  check('第三批后 pending 归零', g.pending === 0, `pending=${g.pending}`);
  check('全部批次后 alive === capacity', g.alive === g.capacity, `${g.alive}/${g.capacity}`);
  check('放完转格斗态', g.phase === 'engaging', g.phase);
  check('已满编后不再放飞', F.launchBatch(g) === 0);
  const total = b1 + b2 + b3;
  check('三批之和 === 满编（无泄漏）', total === g.capacity, `${total}/${g.capacity}`);
}

console.log('\n=== B. 目标优先级：变化的核心来源 ===');
check('敌舰载机优先级最高', F.targetPriority('fighter', 200) > F.targetPriority('battleship', 200));
check('敌战舰高于敌航母', F.targetPriority('battleship', 200) > F.targetPriority('carrier', 200));
check('运输舰优先级为 -1（禁止攻击）', F.targetPriority('supply', 50) === -1);
check('mayAttackSupply 硬性为 false', F.mayAttackSupply() === false);
check('负优先级恒定低于任何可选目标',
  F.targetPriority('supply', 0) < F.targetPriority('carrier', 9999));
check('无目标优先级为 0', F.targetPriority('none', 100) === 0);
check('舰载机优先级随距离衰减', F.targetPriority('fighter', 100) > F.targetPriority('fighter', 900));
check('但远距离仍高于战舰近距（活动性强，不因远放弃）',
  F.targetPriority('fighter', 800) > F.targetPriority('battleship', 100));

console.log('\n=== C. 攻击部位：航母下方弱点窗口窄 ===');
check('近距离打航母 = ventral（弱点）', F.hitZoneFor('carrier', 100) === 'ventral');
check('远距离打航母 = hull（窗口已过）', F.hitZoneFor('carrier', F.FIGHTER_VENTRAL_RANGE + 50) === 'hull');
check('打战舰永不为 ventral', F.hitZoneFor('battleship', 10) === 'hull');
check('弱点暴露距离有上限', F.FIGHTER_VENTRAL_RANGE > 0 && F.FIGHTER_VENTRAL_RANGE < 400);

console.log('\n=== D. 五态状态机 ===');
{
  const g = mk();
  g.phase = 'engaging'; g.alive = 10;
  const d = F.advanceFighters(g, ENGAGE, 0.1);
  check('均势未损失 ⇒ 维持格斗', d.phase === 'engaging' && d.reason === 'engage', d.phase);
}
{
  const g = mk();
  g.phase = 'engaging'; g.alive = 10;
  const d = F.advanceFighters(g, { ...ENGAGE, lossRate: 0.6 }, 0.1);
  check('损失过半 ⇒ 转脱离', d.phase === 'withdrawing', d.phase);
}
{
  const g = mk();
  g.phase = 'engaging'; g.alive = 10;
  const d = F.advanceFighters(g, { ...ENGAGE, ratio: 0.4 }, 0.1);
  check('数量比 0.4 < 0.6 ⇒ 转脱离', d.phase === 'withdrawing', d.phase);
}
{
  const g = mk();
  g.phase = 'engaging'; g.alive = 10;
  const d = F.advanceFighters(g, { ...ENGAGE, hasTarget: false }, 0.1);
  check('无目标 ⇒ 脱离', d.phase === 'withdrawing', d.phase);
}

console.log('\n=== E. 空袭窗口：唯一有伤害的时机 ===');
{
  const g = mk();
  g.phase = 'engaging'; g.alive = 10;
  // 母舰脱离接触 + 有目标 ⇒ 脱离途中穿甲突击
  const d = F.advanceFighters(g, { ...ENGAGE, carrierDisengaged: true, hasTarget: true }, 0.1);
  check('母舰脱离后进入空袭（striking）', d.phase === 'striking' && d.striking === true, d.phase);
  check('空袭是唯一 striking=true 的状态', d.striking === true);
}
{
  // 格斗态（母舰未脱离）不得空袭
  const g = mk();
  g.phase = 'engaging'; g.alive = 10;
  const d = F.advanceFighters(g, { ...ENGAGE, carrierDisengaged: false }, 0.1);
  check('母舰未脱离时不得空袭（striking=false）', d.striking === false, d.reason);
}
{
  // 空袭中损失过大 ⇒ 放弃拉起
  const g = mk();
  g.phase = 'striking'; g.alive = 10;
  const d = F.advanceFighters(g, { ...ENGAGE, lossRate: 0.8 }, 0.1);
  check('空袭中损失 0.8 > 0.65 ⇒ 放弃拉起', d.phase === 'returning', d.phase);
}
{
  // 返航：母舰在 ⇒ 保持返航态
  const g = mk();
  g.phase = 'returning'; g.alive = 6;
  const d = F.advanceFighters(g, { ...ENGAGE, carrierAlive: true }, 0.1);
  check('母舰在场 ⇒ 维持返航（自动著舰）', d.phase === 'returning', d.phase);
}
{
  // 全灭 ⇒ 返航态
  const g = mk();
  g.phase = 'engaging'; g.alive = 0;
  const d = F.advanceFighters(g, ENGAGE, 0.1);
  check('全灭 ⇒ 转返航', d.phase === 'returning', d.phase);
}
{
  // 母舰沉没 + 正在返航 ⇒ 转为继续格斗（无处可返）
  const g = mk();
  g.phase = 'returning'; g.alive = 5;
  const d = F.advanceFighters(g, { ...ENGAGE, carrierAlive: false }, 0.1);
  check('母舰沉没 ⇒ 不再返航，转拼死格斗', d.phase === 'engaging', d.phase);
}

console.log('\n=== F. 1:1 交换与数量差衰减 ===');
check('4v4 单轮交换 1 架', F.resolveClash(4, 4, 1) === 1);
check('8v8 单轮仍只损 1 架（不按人数翻倍）', F.resolveClash(8, 8, 1) === 1);
check('4v1 时劣势方几乎无损（<1 被夹为 1）', F.resolveClash(1, 4, 1) === 1);
{
  const even = F.resolveClash(6, 6, 3);
  const lopsided = F.resolveClash(2, 8, 3);
  check('数量均势交换率高于劣势方', even > lopsided, `${even} vs ${lopsided}`);
  check('交换率不超轮数上限', even <= 3 && lopsided <= 3);
}
check('零架不交换', F.resolveClash(0, 4, 1) === 0);
check('round<1 不交换', F.resolveClash(4, 4, 0) === 0);

console.log('\n=== G. 连锁爆炸（航母下方弱点） ===');
{
  const input = {
    carrierUid: 'CV1', hitZone: 'ventral', carrierX: 500, carrierY: 500,
    enemyFighters: [
      { id: 'f1', x: 520, y: 500 },   // 距 20 ⇒ 在 120 内
      { id: 'f2', x: 610, y: 500 },   // 距 110 ⇒ 在 120 内
      { id: 'f3', x: 700, y: 500 },   // 距 200 ⇒ 在 120 外
    ],
    friendlyShips: [
      { uid: 'S1', x: 530, y: 500, hpRatio: 1.0 },   // 距 30 ⇒ 受冲击
      { uid: 'S2', x: 560, y: 500, hpRatio: 1.0 },   // 距 60 ⇒ 受冲击
      { uid: 'S3', x: 620, y: 500, hpRatio: 1.0 },   // 距 120 ⇒ 在 80 外
    ],
  };
  const r = F.resolveChainBlast(input);
  check('ventral 命中 ⇒ 航母被引爆', r.carrierDestroyed === true);
  check('半径内敌方舰载机全灭（f1/f2）',
    r.fightersKilled.length === 2 && r.fightersKilled.includes('f1') && r.fightersKilled.includes('f2'),
    r.fightersKilled.join(','));
  check('半径外舰载机存活（f3 不在内）', !r.fightersKilled.includes('f3'));
  check('友舰受冲击波（80 半径内 S1/S2）',
    r.shipsDamaged.length === 2, r.shipsDamaged.map((d) => d.uid).join(','));
  check('友舰 HP 比例下降 0.3', r.shipsDamaged[0].hpRatio === 0.7, String(r.shipsDamaged[0].hpRatio));
  check('友舰 HP 不归零（有 0.1 下限）',
    F.resolveChainBlast({ ...input, friendlyShips: [{ uid: 'X', x: 500, y: 500, hpRatio: 0.1 }] }).shipsDamaged[0].hpRatio >= 0.1);
}
{
  // 打非 ventral ⇒ 不引爆（原作：需穿甲后在其下方盘旋）
  const r = F.resolveChainBlast({
    carrierUid: 'CV1', hitZone: 'hull', carrierX: 0, y: 0,
    enemyFighters: [{ id: 'f1', x: 0, y: 0 }],
    friendlyShips: [{ uid: 'S1', x: 0, y: 0, hpRatio: 1 }],
  });
  check('hull 命中不引爆、无连锁', r.carrierDestroyed === false && r.fightersKilled.length === 0);
}

console.log('\n=== H. 伤害配平：占比有上下限意义 ===');
{
  const perShip = 100;
  const d12 = F.fighterDamage(12, perShip);
  const d2 = F.fighterDamage(2, perShip);
  // 单架伤害 = 母舰**单舰**火力 × 份额（capacity 只决定波次规模总量，不放大单架）
  check('single-fighter damage is independent of capacity (share is per capital ship)',
    d12 === d2, d12 + ' vs ' + d2);
  check('单架伤害 = 母舰单舰火力 × 份额',
    d12 === Math.round(perShip * F.FIGHTER_DAMAGE_SHARE * 100) / 100 || d12 === perShip * F.FIGHTER_DAMAGE_SHARE,
    String(d12));
  check('零搭载 ⇒ 零伤害', F.fighterDamage(0, perShip) === 0);
  const totalShare = F.FIGHTER_DAMAGE_SHARE;
  check('份额在合理区间（0.1~0.35，避免喧宾夺主或不可感知）',
    totalShare > 0.1 && totalShare < 0.35, String(totalShare));
}

console.log('\n=== I. 配平自检：舰载机伤害占全场 15~35% ===');
{
  // 2 母舰 × 12 架 vs 10 战列的典型编成
  const fighters = 2 * F.FIGHTER_CAPACITY;
  const fighterDps = fighters * F.FIGHTER_DAMAGE_SHARE;   // 以"母舰单舰火力"为单位
  const battleships = 10;
  const total = fighterDps + battleships;
  const share = fighterDps / total;
  check('舰载机伤害占全场 15~35%（31 号 §阶段B 验收判据）',
    share >= 0.15 && share <= 0.35, `${(share * 100).toFixed(1)}%`);
}

console.log(`\n=== fighterWavesSim: ${passed} PASS / ${failed} FAIL ===`);
process.exit(failed > 0 ? 1 : 0);
