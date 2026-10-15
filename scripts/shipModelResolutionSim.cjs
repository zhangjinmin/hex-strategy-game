/**
 * v61 舰船模型解析链行为契约台架（同盟侧兜底模型回归缺陷）
 *
 * 判据（对应 2026-09-30 同盟侧程序化兜底诊断）：
 *   A. 演习/战役两套 classType 口径（中文 t?.cls/SHIP_TYPE_CN + 英文 ShipType）
 *      经 SHIP_CLASS_ALIAS 归一后必须命中真实 GLB 文件（含家族回退），
 *      任何可达 classType 都不允许落到"候选全空 → 程序化兜底"。
 *   B. CLS_ALIAS（dimsOf 尺寸表）覆盖同一中文键集（尺寸不得退化成驱逐舰）。
 *   C. 编制生成尊重 FACTION_SHIP_RESTRICTION（同盟禁高战，份额并入战列，总数不变）。
 *   D. 同类键名不匹配的历史教训（'航母' vs '空母'）不得复发：'空母'/'舰载' 映射保持。
 *
 * 真源码口径：
 *   · gameData.ts / shipScaling.ts 直接 require（行为断言）；
 *   · SHIP_CLASS_ALIAS / CLS_ALIAS 从 shipModels.ts / Battle3DOverlay.ts 源码字面量提取后 eval
 *     （读的是真源码字节，表改了台架自动跟）；
 *   · 文件命中以 frontend/src/assets/ship/ 真实目录为准。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gameData = require('../frontend/src/config/gameData.ts');
const shipScaling = require('../frontend/src/config/shipScaling.ts');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

/** 从 TS 源码提取 `NAME: Record<string, string> = { ... };` 的对象字面量并 eval */
function extractTable(source, name, file) {
  const re = new RegExp(`(?:const|export const) ${name}[^=]*=\\s*\\{`, 'm');
  const m = re.exec(source);
  assert.ok(m, `${file}: 找不到 ${name} 表`);
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > 0, `${file}: ${name} 括号不闭合`);
  // eslint-disable-next-line no-eval
  return eval('(' + source.slice(start, end) + ')');
}

const shipModelsSrc = fs.readFileSync('./frontend/src/game/three/shipModels.ts', 'utf8');
const overlaySrc = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const SHIP_CLASS_ALIAS = extractTable(shipModelsSrc, 'SHIP_CLASS_ALIAS', 'shipModels.ts');
const CLS_ALIAS = extractTable(overlaySrc, 'CLS_ALIAS', 'Battle3DOverlay.ts');

// 真实模型文件集（基础名；LOD 是同名变体，缺档静默回落基础文件，不影响命中判定）
const SHIP_DIR = './frontend/src/assets/ship';
const glbFiles = new Set(fs.readdirSync(SHIP_DIR).filter((f) => /\.glb$/i.test(f)));

/** buildShip 候选顺序的镜像（旗舰 key 除外；断言其源码契约后按此复算） */
function candidatesFor(classType, factionKey) {
  const cls = SHIP_CLASS_ALIAS[classType] || null;
  const candidates = [];
  if (cls) {
    candidates.push(`${factionKey}_${cls}.glb`, `${cls}.glb`);
    if (cls === 'electronic') candidates.push(`${factionKey}_cruiser.glb`, 'cruiser.glb');
    if (cls === 'fast_battleship') candidates.push(`${factionKey}_battleship.glb`, 'battleship.glb');
  }
  return candidates;
}

console.log('\n=== A. classType 全集 → 模型文件命中（禁程序化兜底）===');
// 可达 classType 全集：
//   中文：SHIP_TYPE_CN 全值（演习 t?.cls||SHIP_TYPE_CN 口径）∪ troopNames 舰种键（t?.cls 命中口径）∪ REFUGEE.cls
//   英文：SHIP_TYPE_ORDER 全键（战役 slot.type 口径）
const troopClassKeys = new Set();
for (const fac of Object.keys(gameData.troopNames)) {
  for (const cls of Object.keys(gameData.troopNames[fac])) troopClassKeys.add(cls);
}
const allClassTypes = new Set([
  ...Object.values(shipScaling.SHIP_TYPE_CN),
  ...troopClassKeys,
  gameData.REFUGEE.cls,
  ...shipScaling.SHIP_TYPE_ORDER,
]);

for (const classType of [...allClassTypes].sort()) {
  for (const factionKey of ['empire', 'alliance']) {
    check(`classType=${classType} @${factionKey} 命中真实 GLB`, () => {
      const cands = candidatesFor(classType, factionKey);
      assert.ok(SHIP_CLASS_ALIAS[classType], `SHIP_CLASS_ALIAS 缺 '${classType}' 键 ⇒ cls=null ⇒ 程序化兜底`);
      const hit = cands.find((f) => glbFiles.has(f));
      assert.ok(hit, `候选 [${cands.join(', ')}] 全部落空 ⇒ 程序化兜底`);
    });
  }
}

console.log('\n=== B. CLS_ALIAS 尺寸表覆盖（防尺寸退化成驱逐舰）===');
for (const classType of [...allClassTypes].sort()) {
  check(`CLS_ALIAS 覆盖 '${classType}'`, () => {
    // 英文键经 SHIP_RATIO 直查，不依赖 CLS_ALIAS；中文键必须登记
    const zhOnly = !shipScaling.SHIP_TYPE_ORDER.includes(classType);
    if (zhOnly) assert.ok(CLS_ALIAS[classType], `CLS_ALIAS 缺 '${classType}' ⇒ dimsOf 退化 destroyer 尺寸`);
  });
}

console.log('\n=== C. 编制遵守 FACTION_SHIP_RESTRICTION（同盟禁高战）===');
check('同盟编制：高战归零、并入战列、总数不变', () => {
  const comp = { battleships: 25, fastBattleships: 10, cruisers: 30, destroyers: 25, carriers: 5, fighters: 5 };
  const totalBefore = Object.values(comp).reduce((a, b) => a + b, 0);
  gameData.applyFactionShipRestriction('alliance', comp);
  assert.equal(comp.fastBattleships, 0);
  assert.equal(comp.battleships, 35);
  const totalAfter = Object.values(comp).reduce((a, b) => a + b, 0);
  assert.equal(totalAfter, totalBefore);
});
check('帝国编制：不受限制、保持不变', () => {
  const comp = { battleships: 25, fastBattleships: 10, cruisers: 30, destroyers: 25, carriers: 5, fighters: 5 };
  gameData.applyFactionShipRestriction('empire', comp);
  assert.equal(comp.fastBattleships, 10);
  assert.equal(comp.battleships, 25);
});
check('编制生成入口全部接入限制（源码契约）', () => {
  const storeSrc = fs.readFileSync('./frontend/src/store/gameStore.ts', 'utf8');
  const panelSrc = fs.readFileSync('./frontend/src/components/meta/BattleSetupPanel.vue', 'utf8');
  const storeHits = (storeSrc.match(/applyFactionShipRestriction\(/g) || []).length;
  assert.ok(storeHits >= 3, `gameStore 只有 ${storeHits} 处调用（应≥3：generateSimFullComposition + 2 处舰队初始化）`);
  assert.ok(/import \{[^}]*applyFactionShipRestriction/.test(storeSrc), 'gameStore 未导入 applyFactionShipRestriction');
  assert.ok(panelSrc.includes('applyFactionShipRestriction('), 'BattleSetupPanel 兜底编制未接入限制');
  assert.ok(/generateSimFullComposition\(rank,\s*(adm\.faction|eAdm\.faction)\)/.test(storeSrc), 'launchSimBattle 未把 faction 传入编制生成');
});

console.log('\n=== D. 历史键名教训不复发 ===');
check("'空母'/'舰载'/'高战'/'无' 映射保持（'航母' 错键教训）", () => {
  assert.equal(SHIP_CLASS_ALIAS['空母'], 'carrier');
  assert.equal(SHIP_CLASS_ALIAS['舰载'], 'fighter');
  assert.equal(SHIP_CLASS_ALIAS['高战'], 'fast_battleship');
  assert.equal(SHIP_CLASS_ALIAS['无'], 'supply');
});
check('buildShip 家族回退契约在源码中（electronic→cruiser / fast_battleship→battleship）', () => {
  assert.ok(overlaySrc.includes('${factionKey}_cruiser.glb'), 'electronic→cruiser 回退丢失');
  assert.ok(overlaySrc.includes('${factionKey}_battleship.glb'), 'fast_battleship→battleship 回退丢失');
});

console.log('\n=== E. [v62] meshopt 解码器 / troop 折叠 / GLB 容器审计 ===');
const battleSceneSrc = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');

check('troopLikeFromClass：全中文 cls 都取 baseStats 真源值（射程口径不手抄）', () => {
  for (const cls of Object.keys(gameData.baseStats)) {
    const t = gameData.troopLikeFromClass(cls);
    assert.ok(t, `troopLikeFromClass('${cls}') 返回 undefined`);
    const b = gameData.baseStats[cls];
    assert.equal(t.cls, cls);
    assert.equal(t.range, b.range);
    assert.equal(t.interval, b.interval);
    assert.equal(t.speed, b.speed);
    assert.equal(t.def, b.def);
  }
  assert.equal(gameData.troopLikeFromClass('不存在的舰种'), undefined);
});
check('BattleScene troopOf 不再裸用 getTroopById（防 troopsData[0] 静默折叠复发）', () => {
  // [P1] 演习轨改经统一入口 buildFleetUnits({ mode:'sim', ... troopOf }) —— troopOf 块随之外移内联，
  //      断言口径不变（仍是"BattleScene 内联 troopOf 不得裸调 getTroopById 且必须接 troopLikeFromClass"）。
  // [P1 加固] 锚点唯一化：在起始 token 右侧追加「紧跟换行」约束。
  //   原因（红队+审核方交叉实测）：`buildFleetUnits({` 在 BattleScene 出现 **2 次** ——
  //     · :1491 文档注释里也写了该调用写法（无换行紧跟）
  //     · :1509 真实 troopOf 代码块（起始 token 后**紧跟换行**）
  //   无此约束时，匹配**起点**由窗口 N 决定：N∈[700,1676] 命中 :1509（正确）；
  //   N≥1677 起点前移到 :1491 注释跨度（吞进块外文本 ⇒ 假失败）。
  //   加上 `\r?\n` 后锚点唯一 ⇒ 不再依赖窗口值的正确性（保持 1200 即可）。
  const m = battleSceneSrc.match(/buildFleetUnits\(\{\r?\n[\s\S]{0,1200}?\n {12}\}/);
  assert.ok(m, '找不到 buildFleetUnits 调用块');
  assert.ok(!/getTroopById\(/.test(m[0]), 'troopOf 仍在裸调用 getTroopById（高战/空母/舰载会被折叠成 troopsData[0].cls）');
  assert.ok(m[0].includes('troopLikeFromClass'), 'troopOf 未接 troopLikeFromClass 合成兜底');
});
check('GLTFLoader 必须注册 MeshoptDecoder（否则 meshopt 压缩 GLB 解析必败）', () => {
  assert.ok(shipModelsSrc.includes("from 'three/examples/jsm/libs/meshopt_decoder.module.js'"), '未导入 MeshoptDecoder');
  assert.ok(shipModelsSrc.includes('setMeshoptDecoder(MeshoptDecoder)'), 'GLTFLoader 未注册 MeshoptDecoder');
});
check('acquireShipModelByFiles：解析失败的候选跳过、继续回退（契约回归）', () => {
  assert.ok(shipModelsSrc.includes("reg.status === 'failed') continue"), '失败候选不再回退后续候选');
});
check('GLB 容器审计：全部可解析 / 非零网格 / 无缺解码器的 required 扩展', () => {
  const dir = './frontend/src/assets/ship';
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb'));
  assert.ok(files.length > 0, '模型目录为空');
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    assert.equal(buf.readUInt32LE(0), 0x46546c67, `${f}: 魔数错`);
    const jlen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jlen).toString('utf8'));
    const prims = (json.meshes || []).reduce((a, m) => a + (m.primitives || []).length, 0);
    assert.ok(prims > 0, `${f}: 零网格（运行时必 'failed'）`);
    for (const ext of (json.extensionsRequired || [])) {
      if (/draco/i.test(ext)) assert.fail(`${f}: required ${ext} 但工程无 DRACOLoader`);
    }
  }
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
