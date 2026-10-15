/**
 * fleetGenerationSim.cjs — P1「统一舰队生成入口」行为契约台架。
 *
 * 基准：docs/design/3d-tactical-battle/33-p1-spec.md §2.3（4 类断言）。
 *
 * 真源码口径（禁手抄常量）：
 *   · frontend/src/game/fleetGeneration.ts —— 被测入口 buildFleetUnits（直接 require 真源码）；
 *   · frontend/src/config/shipScaling.ts    —— 旧路径底层原语 buildTacticalUnits /
 *                                              scaledSlotsForComposition / applyStatsToSlots + 真源表/实体数规则；
 *   · frontend/src/config/gameData.ts       —— troop 合成真源 troopLikeFromClass（演习轨兜底口径）；
 *   · BattleScene.ts / gameStore.ts         —— 源码契约：两轨都已改调统一入口；
 *                                              另固化 2 个「P3 待办·未统一分支」为可测事实。
 *
 * 4 类断言（定稿 §2.3）：
 *   1. 守恒律    —— 同 composition + 同 visualCount ⇒ ΣmaxHp/Σatk 与实体数无关（两 mode / 跨 visualCount 相等）
 *   2. 实体数    —— entityCount === effectiveFleetUnits(composition, visualCount)（真源函数，不手抄）
 *   3. mods 语义 —— sim ⇒ 全 1；campaign ⇒ 等于传入值（partial 缺项按 1），并含 0 / NaN / -3 边界
 *   4. ★ 零行为变化回放 —— **参照系 = 手工逐字重建的「P1 改造前调用方表达式」**（只经底层原语，
 *                        绝不经过 buildFleetUnits）；**被验证方 = buildFleetUnits 本身**；逐字段必须相等。
 *   （另：第 5 类为源码契约，含两轨统一点 + 2 个 P3 未统一分支的可测事实）
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shipScaling = require('../frontend/src/config/shipScaling.ts');
const gameData = require('../frontend/src/config/gameData.ts');
const { buildFleetUnits } = require('../frontend/src/game/fleetGeneration.ts');

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
// 夹具
// ────────────────────────────────────────────────────────────

/** 3 组代表性编制（ShipType 键；已归一，等价于 totalsOfComposition 的产物） */
const COMPS = [
  { label: '纯战列', c: { battleship: 5000 } },
  { label: '混编', c: { battleship: 3000, fast_battleship: 1200, cruiser: 2000, destroyer: 1500, carrier: 500, fighter: 800 } },
  { label: '含补给', c: { battleship: 2000, cruiser: 1000, destroyer: 900, supply: 600 } },
];

const UNIT_MODS = { hpMul: 1, atkMul: 1, defMul: 1, engineMul: 1 };
const NON_UNIT_MODS = { hpMul: 1.2, atkMul: 0.85, defMul: 1.07, engineMul: 1.03 };

/** 演习轨 troopOf 真源口径：store.troopsData 严格查找缺失 ⇒ troopLikeFromClass 合成（BattleScene:1515-1521） */
const simTroopOf = (type) => gameData.troopLikeFromClass(shipScaling.SHIP_TYPE_CN[type]);
/** 战役轨 troopOf 真源口径：getTroopById 产物（只消费 cls/def/speed/range/interval）——此处用 baseStats 同源合成 */
const campaignTroopOf = (type) => {
  const cn = shipScaling.SHIP_TYPE_CN[type];
  const b = gameData.baseStats[cn];
  return b
    ? { cls: cn, def: b.def, speed: b.speed, range: b.range, interval: b.interval }
    : undefined;
};

/** 与实体数等长的坐标源（触发 coordSource 复用分支） */
const coordsOf = (n) => Array.from({ length: n }, (_, i) => ({ x: i * 3 + 1, y: i * 5 + 2 }));

const SEED_KEYS = ['type', 'classType', 'count', 'hp', 'maxHp', 'atk', 'def', 'speed', 'range', 'interval', 'gridX', 'gridY'];

/** 逐字段断言两个 seeds 完全相等（含字段集） */
function assertSeedsEqual(a, b, label) {
  assert.equal(a.length, b.length, `${label}: 实体数不同 ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i += 1) {
    assert.deepEqual(
      Object.keys(a[i]).sort(), Object.keys(b[i]).sort(),
      `${label}: seed[${i}] 字段集不同`,
    );
    for (const k of SEED_KEYS) {
      assert.equal(a[i][k], b[i][k], `${label}: seed[${i}].${k} 不同 (${a[i][k]} vs ${b[i][k]})`);
    }
  }
}

const activeTypes = (comp) => shipScaling.SHIP_TYPE_ORDER.filter((t) => (comp[t] || 0) > 0).length;

// ────────────────────────────────────────────────────────────
console.log('\n=== 1. 守恒律：ΣmaxHp / Σatk 与实体数、轨道标识无关 ===');
// ────────────────────────────────────────────────────────────
for (const { label, c } of COMPS) {
  check(`[${label}] 跨 visualCount ΣHP/ΣATK 不变（守恒）`, () => {
    const base = buildFleetUnits({ mode: 'sim', composition: c, visualCount: 100, troopOf: simTroopOf }).diag;
    for (const vc of [1, 7, 50, 200, 500]) {
      const d = buildFleetUnits({ mode: 'sim', composition: c, visualCount: vc, troopOf: simTroopOf }).diag;
      assert.equal(d.sumHp, base.sumHp, `visualCount=${vc} 时 ΣmaxHp 漂移`);
      assert.equal(d.sumAtk, base.sumAtk, `visualCount=${vc} 时 Σatk 漂移`);
    }
  });
  check(`[${label}] 两 mode（campaign 传全 1）ΣHP/ΣATK + seeds 相等`, () => {
    const sim = buildFleetUnits({ mode: 'sim', composition: c, visualCount: 100, troopOf: simTroopOf });
    const camp = buildFleetUnits({ mode: 'campaign', composition: c, visualCount: 100, campaignMods: UNIT_MODS, troopOf: campaignTroopOf });
    // 注意：campaign 用 campaignTroopOf、sim 用 simTroopOf，两者产物经 applyStatsToSlots 后 def/speed/range/interval
    // 由同一 baseStats 真源给出 ⇒ 数值应一致（若不一致说明 troop 真源本身有别，属 P3 范畴）。
    assert.equal(camp.diag.sumHp, sim.diag.sumHp, 'campaign(全1) 与 sim ΣmaxHp 不同');
    assert.equal(camp.diag.sumAtk, sim.diag.sumAtk, 'campaign(全1) 与 sim Σatk 不同');
  });
  check(`[${label}] diag.sumHp = Σ seeds.maxHp，diag.sumAtk = Σ seeds.atk`, () => {
    const r = buildFleetUnits({ mode: 'sim', composition: c, visualCount: 64, troopOf: simTroopOf });
    const sh = r.seeds.reduce((a, s) => a + s.maxHp, 0);
    const sa = r.seeds.reduce((a, s) => a + s.atk, 0);
    assert.equal(r.diag.sumHp, sh, 'diag.sumHp ≠ ΣmaxHp');
    assert.equal(r.diag.sumAtk, sa, 'diag.sumAtk ≠ Σatk');
    assert.equal(r.diag.totals, shipScaling.totalShipsOf(c), 'diag.totals ≠ Σ编制兵力');
    assert.equal(r.diag.entityCount, r.seeds.length, 'diag.entityCount ≠ seeds.length');
  });
}

// ────────────────────────────────────────────────────────────
console.log('\n=== 2. 实体数：entityCount === effectiveFleetUnits（真源，不手抄） ===');
// ────────────────────────────────────────────────────────────
for (const { label, c } of COMPS) {
  check(`[${label}] entityCount 命中真源规则（含 0 / 抬升到有兵舰种数）`, () => {
    for (const vc of [0, 1, 3, 8, 100, 500]) {
      const expect = shipScaling.effectiveFleetUnits(c, vc);
      const r = buildFleetUnits({ mode: 'sim', composition: c, visualCount: vc, troopOf: simTroopOf });
      assert.equal(r.seeds.length, expect, `visualCount=${vc} 实体数 ${r.seeds.length} ≠ 真源 ${expect}`);
      if (vc > 0) assert.ok(r.seeds.length >= activeTypes(c), '实体数应 ≥ 有兵舰种数（各舰种至少 1）');
    }
  });
}

// ────────────────────────────────────────────────────────────
console.log('\n=== 3. mods 语义：sim ⇒ 全 1；campaign ⇒ 传入值 + 边界（0 / NaN / -3 / partial） ===');
// ────────────────────────────────────────────────────────────
const MIX = COMPS[1].c;
check("mode='sim' ⇒ mods 与 diag.mods 全 1", () => {
  const r = buildFleetUnits({ mode: 'sim', composition: MIX, visualCount: 50, troopOf: simTroopOf });
  assert.deepEqual(r.mods, UNIT_MODS);
  assert.deepEqual(r.diag.mods, UNIT_MODS);
});
check("mode='campaign' ⇒ mods = 传入值（完整）", () => {
  const r = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: NON_UNIT_MODS, troopOf: campaignTroopOf });
  assert.deepEqual(r.mods, NON_UNIT_MODS);
  assert.deepEqual(r.diag.mods, NON_UNIT_MODS);
});
check('mode=\'campaign\' + partial/null ⇒ 缺项按 1 兜底', () => {
  const p = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { hpMul: 2 }, troopOf: campaignTroopOf });
  assert.deepEqual(p.mods, { hpMul: 2, atkMul: 1, defMul: 1, engineMul: 1 });
  const n = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: null, troopOf: campaignTroopOf });
  assert.deepEqual(n.mods, UNIT_MODS);
  const u = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, troopOf: campaignTroopOf });
  assert.deepEqual(u.mods, UNIT_MODS);
});
check("campaign 倍率确实作用到数值（hpMul=2 ⇒ ΣmaxHp ≈ 2×；且 ≠ 全 1 结果）", () => {
  const one = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: UNIT_MODS, troopOf: campaignTroopOf }).diag;
  const two = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { ...UNIT_MODS, hpMul: 2 }, troopOf: campaignTroopOf }).diag;
  assert.ok(two.sumHp !== one.sumHp, 'hpMul=2 未改变 ΣmaxHp');
  assert.ok(Math.abs(two.sumHp - 2 * one.sumHp) <= activeTypes(MIX), `hpMul=2 的 ΣmaxHp(${two.sumHp}) 非 ≈2×(${one.sumHp})`);
});

// ── 缺陷2：mods 边界用例（消除"只测全 1 / 全非零"的覆盖盲区）──
//    关键：`modsFromPartial` 用 `??` ⇒ 0 与 NaN 必须**穿透**；若被误写成 `||`，0/NaN 会被兜底成 1（经典回归）。
check('边界·campaignMods.hpMul=0 ⇒ 穿透 0（不得被 || 兜底成 1），且 ΣmaxHp=0', () => {
  const r = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { hpMul: 0 }, troopOf: campaignTroopOf });
  assert.equal(r.mods.hpMul, 0, 'hpMul=0 被兜底（?? 误写成 || 的经典回归）');
  assert.equal(r.diag.mods.hpMul, 0, 'diag.mods.hpMul 应为 0');
  assert.equal(r.diag.sumHp, 0, 'hpMul=0 ⇒ ΣmaxHp 必须为 0');
  assert.ok(r.seeds.every((s) => s.maxHp === 0 && s.hp === 0), 'hpMul=0 未作用到逐实体 maxHp/hp');
  assert.equal(r.mods.atkMul, 1, '未提供的 atkMul 应兜底为 1');
});
check('边界·campaignMods.atkMul=NaN ⇒ NaN 穿透（不得被兜底成 1）', () => {
  const r = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { atkMul: NaN }, troopOf: campaignTroopOf });
  assert.ok(Number.isNaN(r.mods.atkMul), 'atkMul=NaN 未穿透（?? 误用 || 会变 1）');
  assert.ok(Number.isNaN(r.diag.mods.atkMul), 'diag.mods.atkMul 应为 NaN');
  assert.ok(Number.isNaN(r.diag.sumAtk), 'NaN 必须作用到 Σatk（不得被吞掉）');
  assert.ok(Number.isFinite(r.diag.sumHp), 'hpMul=1 ⇒ ΣmaxHp 仍有限（NaN 未串扰 hp 侧）');
});
check('边界·campaignMods.defMul=-3 ⇒ 负值穿透', () => {
  const r = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { defMul: -3 }, troopOf: campaignTroopOf });
  assert.equal(r.mods.defMul, -3, 'defMul=-3 未穿透');
  assert.equal(r.diag.mods.defMul, -3, 'diag.mods.defMul 应为 -3');
  assert.ok(r.seeds.reduce((a, s) => a + s.def, 0) < 0, '负 defMul 未作用到逐实体 def');
});
check('边界·partial 只给 hpMul ⇒ 缺项兜底 1 且 hpMul 保原值', () => {
  const r = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { hpMul: 1.5 }, troopOf: campaignTroopOf });
  assert.deepEqual(r.mods, { hpMul: 1.5, atkMul: 1, defMul: 1, engineMul: 1 });
  assert.deepEqual(r.diag.mods, r.mods);
});
check('边界·显式验证 ?? 语义：0 与 NaN 四字段全穿透，仅 null/undefined 兜底 1', () => {
  const r = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { hpMul: 0, atkMul: NaN, defMul: 0, engineMul: NaN }, troopOf: campaignTroopOf });
  assert.equal(r.mods.hpMul, 0, 'hpMul=0 应穿透');
  assert.equal(r.mods.defMul, 0, 'defMul=0 应穿透');
  assert.ok(Number.isNaN(r.mods.atkMul), 'atkMul=NaN 应穿透');
  assert.ok(Number.isNaN(r.mods.engineMul), 'engineMul=NaN 应穿透');
  const n = buildFleetUnits({ mode: 'campaign', composition: MIX, visualCount: 50, campaignMods: { hpMul: null, atkMul: undefined, defMul: 0, engineMul: 0 }, troopOf: campaignTroopOf });
  assert.equal(n.mods.hpMul, 1, 'null ⇒ 兜底 1');
  assert.equal(n.mods.atkMul, 1, 'undefined ⇒ 兜底 1');
  assert.equal(n.mods.defMul, 0, '0 ⇒ 穿透（对照：与 null 不同）');
  assert.equal(n.mods.engineMul, 0, '0 ⇒ 穿透（对照：与 undefined 不同）');
});

// ────────────────────────────────────────────────────────────
console.log('\n=== 4. ★ 零行为变化回放：参照系=手工逐字重建的旧调用方表达式 → 被验证方=buildFleetUnits ===');
// ────────────────────────────────────────────────────────────
// 【覆盖面边界·必读】**本类只独立验证「包装逻辑」，不独立验证「折算原语」**：
//   · 自证段（两侧共享、**非** P1 改动对象）：编制归一 `totalsOfComposition`、折算原语
//     （`buildTacticalUnits` / `scaledSlotsForComposition` / `applyStatsToSlots`）、
//     `troopOf`、`mods` 数值、`coordSource` —— 这些两侧调的是**同一份真源码**，本类对它们**没有证伪力**。
//   · 真对比段（= P1 改动对象）：包装逻辑 —— `mods` 构造（sim ⇒ SIM_MODS / campaign ⇒ modsFromPartial）
//     + 参数转发（composition / visualCount / coordSource）+ `.seeds` 出口。
//   ⇒ 不得读成本类"整条链都被独立验证"：真正的独立验证对象只有**包装层**。
// 【谁是参照系 / 谁是被验证方】（本次修正的核心，勿再读错）：
//   · 参照系（reference / oracle）＝ **P1 改造前「调用方」表达式的逐字重建**，且刻意**只经底层 public primitives**
//     （buildTacticalUnits / scaledSlotsForComposition + applyStatsToSlots），**绝不经过 buildFleetUnits**。
//   · 被验证方（subject under test）＝ 统一入口 **buildFleetUnits 本身**。
//   ⚠ 反面教材（本台架旧版第 4 类 = 自证）：直接拿 `buildTacticalUnits(...)` 对 `buildFleetUnits(...)`，
//     而后者内部正是把参数逐个直传调 `buildTacticalUnits`（fleetGeneration.ts:91-97）⇒ 退化为 f(x)===f(x)，
//     只能抓「包装层丢参」，抓不到「调用方输入构造契约」的回归 —— 而那恰是 P1 的实际改动位置。
//   本类能证伪：包装层丢参 / mods 默认值（SIM_MODS、modsFromPartial）/ composition 翻译 /
//     coordSource 复用 / `Math.max(1, visualCount)` 语义。且 callers 用**FleetComposition（复数键）**，
//     与改造前 BattleScene/gameStore 持有的输入同形（不再喂预归一 totals）。

// §4 夹具：真实调用方持有的 **FleetComposition（复数键）**
//   （BattleScene 的 fac.composition / gameStore 的 fleet.composition）
const FLEET_COMPS = [
  { label: '纯战列', comp: { battleships: 5000 } },
  { label: '混编', comp: { battleships: 3000, fastBattleships: 1200, cruisers: 2000, destroyers: 1500, carriers: 500, fighters: 800 } },
  { label: '含补给', comp: { battleships: 2000, cruisers: 1000, destroyers: 900, supplies: 600 } },
];

/** 参照系①：逐字重建的【改造前 BattleScene.spawnUnitsForFaction】演习调用方表达式（只经底层原语） */
const legacySimCallerSeeds = (comp, budget, troopOf) => {
  // 旧代码（改造前逐字）：
  //   const totals = totalsOfComposition(comp);
  //   const mods: ShipStatMods = { hpMul: 1, atkMul: 1, defMul: 1, engineMul: 1 };
  //   const units = buildTacticalUnits(totals, budget, mods, troopOf);
  const totals = shipScaling.totalsOfComposition(comp);
  const mods = { hpMul: 1, atkMul: 1, defMul: 1, engineMul: 1 };
  return shipScaling.buildTacticalUnits(totals, budget, mods, troopOf);
};

/** 参照系②：逐字重建的【改造前 gameStore.serializeTacticalFleet】战役调用方表达式（只经底层原语） */
const legacyCampaignCallerSeeds = (comp, visualCount, mods, troopOf, coord) => {
  // 旧代码（改造前逐字）：
  //   slots = buildScaledSlots(fleet.composition, Math.max(1, visualCount), persistedSlots);
  //   return applyStatsToSlots(slots, mods, troopOf);
  //   其中 buildScaledSlots(comp, vc, coord) === scaledSlotsForComposition(totalsOfComposition(comp), vc, coord)
  const slots = shipScaling.scaledSlotsForComposition(
    shipScaling.totalsOfComposition(comp),
    Math.max(1, visualCount),
    coord,
  );
  return shipScaling.applyStatsToSlots(slots, mods, troopOf);
};

for (const { label, comp } of FLEET_COMPS) {
  const totals = shipScaling.totalsOfComposition(comp);
  for (const mode of ['sim', 'campaign']) {
    // [加固②] vc 补 0（原只喂 {1,33,200} ⇒ max(1,vc)≡vc，对"丢了 Math.max"零敏感）。
    for (const vc of [0, 1, 33, 200]) {
      // effective visualCount：sim 原样；campaign 主分支调用方 **Math.max(1, vc)**
      //   （旧代码逐字 = gameStore `visualCount: Math.max(1, visualCount)`）。
      //   coord 也按 effVc 取数，保证 vc=0 时 'match' 仍能命中"条数相等即复用坐标"分支。
      const effVc = mode === 'campaign' ? Math.max(1, vc) : vc;
      for (const coordMode of ['none', 'match', 'mismatch']) {
        const nEff = shipScaling.effectiveFleetUnits(totals, effVc);
        const coord =
          coordMode === 'none' ? undefined
          : coordMode === 'match' ? coordsOf(nEff)
          : coordsOf(Math.max(0, nEff - 1) + 3); // 条数不等 ⇒ 不复用
        check(`[${label}] mode=${mode} vc=${vc} coord=${coordMode} 参照系(旧调用方逐字) ≡ 被验证方(buildFleetUnits) 逐字段`, () => {
          let oldSeeds;
          let newSeeds;
          if (mode === 'sim') {
            // 参照系：旧演习调用方逐字重建
            oldSeeds = legacySimCallerSeeds(comp, vc, simTroopOf);
            // 被验证方：新演习调用方实际路径（BattleScene → buildFleetUnits）
            newSeeds = buildFleetUnits({
              mode: 'sim',
              composition: totals,
              visualCount: vc,
              troopOf: simTroopOf,
            }).seeds;
          } else {
            // 参照系：旧战役调用方逐字重建（mods 为调用方字面量）
            oldSeeds = legacyCampaignCallerSeeds(comp, vc, NON_UNIT_MODS, campaignTroopOf, coord);
            // 被验证方：新战役调用方实际路径（gameStore → buildFleetUnits）
            newSeeds = buildFleetUnits({
              mode: 'campaign',
              composition: totals,
              visualCount: Math.max(1, vc),
              campaignMods: NON_UNIT_MODS,
              troopOf: campaignTroopOf,
              coordSource: coord,
            }).seeds;
          }
          assertSeedsEqual(newSeeds, oldSeeds, `[${label}] mode=${mode} vc=${vc} coord=${coordMode}`);
        });
      }
    }
  }
}

// ── 加固①：补第三分支（无持久化槽位的**兜底**）的参照系（红队缺口 a）──
//   背景：P1 把旧 `serializeTacticalFleet` 的**第三分支**也改了，但 §4 原矩阵**只重建了 main 分支**。
//   旧第三分支逐字：
//     const strength = totalShips(fleet.composition);
//     slots = buildScaledSlots(fleet.composition, fleetVisualCount(strength));
//     return applyStatsToSlots(slots, mods, troopOf);
//   ⚠ 与 main 分支的表面差异：本分支**没有 `Math.max(1, ...)`**，visualCount 直接取 `fleetVisualCount(strength)`。
//   ⚠⚠ [审核方变异实测·2026-10-15] 该差异**对现有夹具不可观测**（无区分力）：
//     把本侧改回 `Math.max(1, vc)` 仍 115 PASS。原因：空编 `strength=0 ⇒ fleetVisualCount=0`，
//     但**空编无论 vc 取 0 还是 1 都产出 0 实体**（`allocateUnitsPerType` 对空编制直接返回 []）；
//     非空时 `fleetVisualCount(strength) ≥ 1` ⇒ `Math.max(1,·)` 恒等。
//   ⇒ 本参照系的真价值 = **补齐旧代码第三分支的分支覆盖**（红队缺口 a），而**不是**
//     '对 Math.max 回归更敏感'（那由 §4 主矩阵 + 加固② 的 vc∈{0,-1} 用例负责）。
//     不要把本条当作 Math.max 的守卫 —— 见 §5『盲区·gameStore 保留 visualCount: Math.max』。
const legacyCampaignFallbackSeeds = (comp, troopOf, mods) => {
  const totals = shipScaling.totalsOfComposition(comp);
  // 旧 `totalShips(fleet.composition)`（types/game.ts）：复数键直接求和。
  // 生产调用方恒为**完整 7 键编制**，此时 `totalShipsOf(totalsOfComposition(comp))` 与其逐字等价；
  // 用归一后的 totals 求和可避免旧 totalShips 在缺键夹具上产生 NaN —— 属夹具构造差异，非口径差异。
  const strength = shipScaling.totalShipsOf(totals);
  const vc = shipScaling.fleetVisualCount(strength);
  const slots = shipScaling.scaledSlotsForComposition(totals, vc); // == buildScaledSlots(comp, vc)
  return shipScaling.applyStatsToSlots(slots, mods, troopOf);
};

const FALLBACK_COMPS = [
  ...FLEET_COMPS,
  { label: '空编', comp: {} }, // strength=0 ⇒ fleetVisualCount=0 ⇒ 0 实体（兜底分支特有 0 边界）
];
for (const { label, comp } of FALLBACK_COMPS) {
  const totals = shipScaling.totalsOfComposition(comp);
  const strength = shipScaling.totalShipsOf(totals);
  const vc = shipScaling.fleetVisualCount(strength);
  check(`[兜底·${label}] strength=${strength} vc=${vc} 参照系(旧第三分支逐字) ≡ 被验证方(buildFleetUnits) 逐字段`, () => {
    const oldSeeds = legacyCampaignFallbackSeeds(comp, campaignTroopOf, NON_UNIT_MODS);
    const newSeeds = buildFleetUnits({
      mode: 'campaign',
      composition: totals,
      visualCount: vc,
      campaignMods: NON_UNIT_MODS,
      troopOf: campaignTroopOf,
    }).seeds;
    assertSeedsEqual(newSeeds, oldSeeds, `[兜底·${label}]`);
  });
}

// ── 加固②：`Math.max(1, vc)` 语义的**区分测试**（红队缺口 b）──
//   被补的缺口：main 分支原只喂 vc∈{1,33,200} ⇒ `Math.max(1,vc) ≡ vc` ⇒ **把 Math.max(1,·) 删掉也不会被抓**
//   （参照系与被验证方**各自独立**写着该字面量，vc≥1 时两侧恒等 ⇒ 对"丢了 Math.max"零敏感）。
//   本用例喂 vc=0 / -1：真实语义 `Math.max(1,0) = Math.max(1,-1) = 1` ⇒ 必须抬到 1 条实体（而非 0）。
//   ⇒ 只要**任一侧**的 `Math.max(1,·)` 被删，本用例立刻假失败（参照系 1 条 vs 被验证方 0 条）。
for (const { label, comp } of FLEET_COMPS) {
  const totals = shipScaling.totalsOfComposition(comp);
  for (const vc of [0, -1]) {
    check(`[${label}] campaign 主分支 vc=${vc} ⇒ Math.max(1,·)=1 ⇒ ≥1 实体 且 ≡ 旧调用方`, () => {
      const oldSeeds = legacyCampaignCallerSeeds(comp, vc, NON_UNIT_MODS, campaignTroopOf, undefined);
      const newSeeds = buildFleetUnits({
        mode: 'campaign',
        composition: totals,
        visualCount: Math.max(1, vc),
        campaignMods: NON_UNIT_MODS,
        troopOf: campaignTroopOf,
        coordSource: undefined,
      }).seeds;
      assert.ok(newSeeds.length >= 1, `vc=${vc} 应被 Math.max(1,·) 抬到 ≥1 实体，实际 ${newSeeds.length}`);
      assertSeedsEqual(newSeeds, oldSeeds, `[${label}] vc=${vc}`);
    });
  }
}

// ────────────────────────────────────────────────────────────
// §4b. 演习轨 troopOf 的**两段式**真源（旧 BattleScene.spawnUnitsForFaction 逐字）
// ────────────────────────────────────────────────────────────
// 旧代码（改造前逐字）：
//   const t = (this.store.troopsData as any[] | undefined)?.find(x => x && x.id === `${trait}_${cn}_1`);
//   return t || troopLikeFromClass(cn);
// 台架此前只用 `troopLikeFromClass`（**第二段**）⇒ 第一段（命中 store.troopsData）从未被覆盖（缺口 c）。
// 这里构造能命中 find 的假 store 数据，验证**命中分支**的 cls/def/speed/range/interval 真值确实流入 seeds，
// 并对照旧调用方逐字表达式（同 §4 口径）。假值刻意区别于 baseStats['战列']（def=15/range=880/interval=3500/speed=0.4）。
const FAKE_STORE_TROOPS = [
  { id: 'empire_战列_1', cls: '战列', def: 77, speed: 7.75, range: 4242, interval: 1234 },
];
const twoStageSimTroopOf = (type) => {
  const cn = shipScaling.SHIP_TYPE_CN[type];
  const t = FAKE_STORE_TROOPS.find((x) => x && x.id === `empire_${cn}_1`);
  return t || gameData.troopLikeFromClass(cn);
};

check('§4b·troopOf 第一段命中 troopsData.find ⇒ 命中 troop 的 def/speed/range/interval 真值流入 seeds', () => {
  const comp = { battleships: 5000 };
  const totals = shipScaling.totalsOfComposition(comp);
  const seeds = buildFleetUnits({ mode: 'sim', composition: totals, visualCount: 5, troopOf: twoStageSimTroopOf }).seeds;
  assert.ok(seeds.length >= 1, '应至少 1 实体');
  for (const s of seeds) {
    assert.equal(s.type, 'battleship');
    assert.equal(s.classType, '战列');
    assert.equal(s.def, 77, `def 未取自命中 troop（期望 77，实得 ${s.def}；baseStats=15 ⇒ 说明走的是兜底段）`);
    assert.equal(s.speed, 7.75, `speed 未取自命中 troop（期望 7.75）`);
    assert.equal(s.range, 4242, `range 未取自命中 troop（期望 4242；baseStats=880）`);
    assert.equal(s.interval, 1234, `interval 未取自命中 troop（期望 1234；baseStats=3500）`);
  }
});
check('§4b·两段式 troopOf（命中段 + 兜底段）经 buildFleetUnits 转发 ≡ 旧调用方逐字', () => {
  const { comp } = FLEET_COMPS[1]; // 混编：含 高战/空母/舰载 等 baseStats-only 舰种 ⇒ 同时覆盖兜底段
  const totals = shipScaling.totalsOfComposition(comp);
  const oldSeeds = legacySimCallerSeeds(comp, 33, twoStageSimTroopOf);
  const newSeeds = buildFleetUnits({ mode: 'sim', composition: totals, visualCount: 33, troopOf: twoStageSimTroopOf }).seeds;
  assertSeedsEqual(newSeeds, oldSeeds, '两段式 troopOf 转发');
});

// ────────────────────────────────────────────────────────────
console.log('\n=== 5. 源码契约：两轨调用点均已改调统一入口 + P3 未统一分支固化 ===');
// ────────────────────────────────────────────────────────────
const sceneSrc = fs.readFileSync(path.join(__dirname, '../frontend/src/game/scenes/BattleScene.ts'), 'utf8');
const storeSrc = fs.readFileSync(path.join(__dirname, '../frontend/src/store/gameStore.ts'), 'utf8');
const genSrc = fs.readFileSync(path.join(__dirname, '../frontend/src/game/fleetGeneration.ts'), 'utf8');

/**
 * 去掉源码中的 `//…` 行注释与块注释（保留字符串字面量内部内容，含转义）。
 * 用途：**源码锚点计数必须排除注释** —— 见下方"计数断言唯一化"注释引用的真实教训。
 */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; out += '\n'; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i];
        i += 1;
      }
      if (i < src.length) out += src[i];
      continue;
    }
    out += c;
  }
  return out;
}

/** 提取每个 `buildFleetUnits( … )` 调用的**平衡圆括号体**（含外层圆括号） */
function extractBuildFleetUnitsCalls(src) {
  const bodies = [];
  const re = /buildFleetUnits\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    bodies.push(src.slice(open, i + 1));
  }
  return bodies;
}

check('BattleScene 已 import buildFleetUnits 且不再直接调 buildTacticalUnits', () => {
  assert.ok(/import \{ buildFleetUnits \} from '\.\.\/fleetGeneration'/.test(sceneSrc), 'BattleScene 未导入统一入口');
  assert.ok(/buildFleetUnits\(\{/.test(sceneSrc), 'BattleScene 未调用 buildFleetUnits');
  assert.ok(!/[^a-zA-Z]buildTacticalUnits\(/.test(sceneSrc), 'BattleScene 仍直接调用 buildTacticalUnits（应只经统一入口）');
});
check("BattleScene 演习轨 mode='sim' 且 troopOf 接 troopLikeFromClass", () => {
  assert.ok(/mode:\s*'sim'/.test(sceneSrc), "BattleScene 未标 mode='sim'");
  assert.ok(sceneSrc.includes('troopLikeFromClass'), 'BattleScene troopOf 未接 troopLikeFromClass 合成兜底');
});
check('gameStore 已 import buildFleetUnits 且 serializeTacticalFleet 走统一入口', () => {
  assert.ok(/import \{ buildFleetUnits \} from '\.\.\/game\/fleetGeneration'/.test(storeSrc), 'gameStore 未导入统一入口');
  assert.ok(/mode:\s*'campaign'/.test(storeSrc), "gameStore 未标 mode='campaign'");
});
check('shipScaling.buildTacticalUnits 仍是唯一底层折算入口（未被本改动修改）', () => {
  assert.ok(genSrc.includes('buildTacticalUnits('), 'fleetGeneration 未委托 buildTacticalUnits');
  assert.ok(/export function buildTacticalUnits\(/.test(
    fs.readFileSync(path.join(__dirname, '../frontend/src/config/shipScaling.ts'), 'utf8'),
  ), 'shipScaling 的 buildTacticalUnits 定义消失');
});

// ── 缺陷3：把 2 个「未统一分支」固化为**可测事实**（P3 待办；此处只加断言，不改生产代码）──
//    目的：让"未统一"被显式记录，而不是随时间被遗忘。若未来 P3 收敛了这些分支，下述断言会失败并提醒同步。
check('P3 待办·未统一分支①：gameStore raw-slot 分支（normalizeRawSlots）不经 buildFleetUnits', () => {
  assert.ok(
    /return applyStatsToSlots\(\s*normalizeRawSlots\(persistedSlots\),\s*mods,\s*troopOf,?\s*\);/.test(storeSrc),
    '未找到 raw-slot 分支仍为 applyStatsToSlots(normalizeRawSlots(...)) —— 该分支应保持不经统一入口（P3 待办）',
  );
  assert.ok(storeSrc.includes('normalizeRawSlots'), 'normalizeRawSlots 特征消失');
});
check('P3 待办·未统一分支②：launchTacticalBattle 崩溃兜底（applyStatsToSlots + neutralMods）不经 buildFleetUnits', () => {
  assert.ok(
    /scaledUnits\s*=\s*applyStatsToSlots\(buildScaledSlots\(comp as any,\s*vc\),\s*neutralMods,\s*troopOfFallback\);/.test(storeSrc),
    '未找到崩溃兜底仍为 applyStatsToSlots(buildScaledSlots(...), neutralMods, ...) —— 该分支应保持不经统一入口（P3 待办）',
  );
  assert.ok(storeSrc.includes('neutralMods'), 'neutralMods 特征消失');
});
check('P3 待办·未统一分支计数：gameStore 内 buildFleetUnits 调用恰为 2 处（两条已统一分支）', () => {
  // [加固④] 计数必须**排除注释**：原写法 `storeSrc.match(/buildFleetUnits\(/g)` 是**全文件裸计数** ——
  //   将来任何注释里出现 `buildFleetUnits(` 都会把计数变成 3 ⇒ **假失败**。
  //   真实教训（shipModelResolutionSim.cjs:171-177）：`buildFleetUnits({` 在 BattleScene 出现 **2 次**
  //   （:1491 文档注释 + :1509 真实代码），注释里那份一度导致锚点匹配拿到错误起点、断言假失败。
  //   ⇒ 此处先 stripComments 再计数，只统计**可执行代码**中的调用。
  const n = (stripComments(storeSrc).match(/buildFleetUnits\(/g) || []).length;
  assert.equal(n, 2, `gameStore 内 buildFleetUnits 调用数=${n}（应恰为 2；若有分支新增/移除统一，请同步 §4 与 P3 待办）`);
});
check('[加固④自检] stripComments 剔除注释中的 `buildFleetUnits(`（防计数被注释误增，且保留字符串字面量）', () => {
  const sample = [
    '// buildFleetUnits(',
    '/* buildFleetUnits(',
    ' * buildFleetUnits(',
    ' */',
    "const s = 'buildFleetUnits(';",
    'const r = buildFleetUnits({});',
  ].join('\n');
  const n = (stripComments(sample).match(/buildFleetUnits\(/g) || []).length;
  assert.equal(n, 2, `stripComments 后应只剩「字符串字面量 + 真实调用」2 处（行注释 + 块注释须被剔除），实得 ${n}`);
});

// ── 加固⑤：盲区 e —— 生产调用方"忘记归一"的源码断言 ──
//   红队指出：`totalsOfComposition` 属 §4 的**自证段**（两侧共享）⇒ §4/§5 均无法捕获
//   "gameStore 误把复数键 `FleetComposition` 直传 composition"的回归
//   （写成 `composition: fleet.composition` ⇒ buildFleetUnits 收到空编制 ⇒ 静默 0 实体，而 §4 仍全绿）。
//   ⇒ 直接对**生产源码**断言：两处 buildFleetUnits 调用都传了 `totalsOfComposition(...)`（不得裸传 `fleet.composition`）。
check('盲区·gameStore 两处 buildFleetUnits 调用均传 totalsOfComposition(...)（不得裸传 fleet.composition）', () => {
  const calls = extractBuildFleetUnitsCalls(stripComments(storeSrc));
  assert.equal(calls.length, 2, `gameStore 内 buildFleetUnits 调用数=${calls.length}（应恰为 2）`);
  calls.forEach((body, i) => {
    assert.ok(
      /composition:\s*totalsOfComposition\(/.test(body),
      `buildFleetUnits 调用#${i + 1} 的 composition 未用 totalsOfComposition 归一（裸传复数键 FleetComposition ⇒ 空 seeds 静默回归）`,
    );
    assert.ok(
      !/composition:\s*fleet\.composition\b/.test(body),
      `buildFleetUnits 调用#${i + 1} 裸传 fleet.composition（复数键）`,
    );
  });
});
check('[加固⑤自检] 裸传 fleet.composition 必须被上方检测判为失败（防断言本身失效）', () => {
  const bad = "return buildFleetUnits({\n  mode: 'campaign',\n  composition: fleet.composition,\n  visualCount: 1,\n});";
  const calls = extractBuildFleetUnitsCalls(stripComments(bad));
  assert.equal(calls.length, 1, '应提取到 1 个调用');
  assert.equal(/composition:\s*totalsOfComposition\(/.test(calls[0]), false, '错误写法不应被判为"已归一"');
  assert.equal(/composition:\s*fleet\.composition\b/.test(calls[0]), true, '错误写法应被裸传检测捕获');
});


// ── [lead 收口] 盲区补遗：生产接线的两处「漏报方向」断言 ──
//   来源：红队 #7（§5 无 visualCount/Math.max 生产断言）+ 审核方 #4（§5 未覆盖 BattleScene 的归一接线）。
//   两处都是**漏报方向**（若生产被改坏、台架不会报）⇒ 必须补。
//   对照：④⑤ 状态机的绕过方向是**假失败**（count 变小 ⇒ 断言 FAIL），方向安全 ⇒ 只记录不补。

check('盲区·gameStore 战役主分支保留 visualCount: Math.max(1, visualCount)', () => {
  // 旧 serializeTacticalFleet 主分支逐字为 `visualCount: Math.max(1, visualCount)`；P1 改造后保留。
  //   若被删（漏报方向），本断言必须 FAIL。
  const src = stripComments(storeSrc);
  const n = (src.match(/visualCount:\s*Math\.max\(1,\s*visualCount\)/g) || []).length;
  assert.equal(n, 1, `gameStore 主分支 visualCount: Math.max(1, visualCount) 命中 ${n} 处（应恰为 1）`);
});
check('[lead 收口自检] 删掉 visualCount 的 Math.max 后，上一断言必须失败', () => {
  const mutated = stripComments(storeSrc).replace(/visualCount:\s*Math\.max\(1,\s*visualCount\)/, 'visualCount: visualCount');
  const n = (mutated.match(/visualCount:\s*Math\.max\(1,\s*visualCount\)/g) || []).length;
  assert.equal(n, 0, `变异后应命中 0 处（证明上一断言可捕获该回归），实得 ${n}`);
});

check('盲区·BattleScene 演习轨传归一后的 composition（totals = totalsOfComposition(comp)）', () => {
  // 与 gameStore 侧同理：应先算 `const totals = totalsOfComposition(comp)` 再传入，
  //   不得把复数键 comp 裸传给 composition（否则空 seeds 静默回归）。
  const src = stripComments(sceneSrc);
  assert.ok(
    /const totals\s*=\s*totalsOfComposition\(comp\)/.test(src),
    'BattleScene 未先计算 totals = totalsOfComposition(comp)',
  );
  const calls = extractBuildFleetUnitsCalls(src);
  assert.ok(calls.length >= 1, `BattleScene 应有 buildFleetUnits 调用，实得 ${calls.length}`);
  calls.forEach((body, i) => {
    assert.ok(
      /composition:\s*totals\b/.test(body),
      `BattleScene 调用#${i + 1} 的 composition 未用 totals（应传 totalsOfComposition(comp) 的结果）`,
    );
  });
});
check('[lead 收口自检] BattleScene 改裸传 comp 后，上一断言必须失败', () => {
  const mutated = stripComments(sceneSrc).replace(/composition:\s*totals\b/g, 'composition: comp');
  const calls = extractBuildFleetUnitsCalls(mutated);
  const bad = calls.filter((body) => !/composition:\s*totals\b/.test(body)).length;
  assert.equal(bad, calls.length, `变异后应全部不满足（证明上一断言可捕获），实得 ${bad}/${calls.length}`);
});

console.log(`\n${passed} assertions passed${failed ? `, ${failed} FAILED` : ''}`);
