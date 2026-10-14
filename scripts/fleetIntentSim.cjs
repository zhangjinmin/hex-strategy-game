/** Deterministic contract for movement/fire arbitration and post-mission autonomy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveFleetIntent } = require('../frontend/src/game/battle/FleetIntentSystem.ts');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (error) { process.stdout.write(`  FAIL ${name}: ${error.message}\n`); process.exitCode = 1; }
}

const point = (x, y) => ({ x, y });
console.log('\n=== Fleet intent arbitration ===');
check('incoming fire returns fire without replacing capture destination', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null,
    attacker: { id: 9, destination: point(40, 0), inWeaponRange: true },
    engagement: null,
    beaconDestination: null,
    mission: { type: 'capture_planet', destination: point(500, 0) },
    knownEnemy: null, fightingAlly: null, forwardSearch: point(700, 0), patrolPoint: point(0, 0),
  });
  assert.deepEqual(intent.destination, point(500, 0));
  assert.equal(intent.fireTargetId, 9);
  assert.equal(intent.kind, 'mission');
});
check('identified enemy pauses capture without erasing it', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null, attacker: null,
    engagement: { id: 12, destination: point(200, 0), inWeaponRange: true },
    beaconDestination: null,
    mission: { type: 'capture_planet', destination: point(500, 0) },
    knownEnemy: null, fightingAlly: null, forwardSearch: point(700, 0), patrolPoint: point(0, 0),
  });
  assert.equal(intent.kind, 'engage');
  assert.equal(intent.fireTargetId, 12);
  assert.equal(intent.missionPaused, true);
});
check('cleared contact resumes the preserved capture mission', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null, attacker: null, engagement: null, beaconDestination: null,
    mission: { type: 'capture_planet', destination: point(500, 0) },
    knownEnemy: null, fightingAlly: null, forwardSearch: point(700, 0), patrolPoint: point(0, 0),
  });
  assert.equal(intent.kind, 'mission');
  assert.deepEqual(intent.destination, point(500, 0));
});
check('autonomy attacks known enemy after objectives are exhausted', () => {
  const intent = resolveFleetIntent({
    retreatDestination: null, attacker: null, engagement: null, beaconDestination: null, mission: null,
    knownEnemy: { id: 22, destination: point(800, 50), inWeaponRange: false },
    fightingAlly: { id: 3, destination: point(400, 10) },
    forwardSearch: point(900, 0), patrolPoint: point(0, 0),
  });
  assert.equal(intent.kind, 'engage');
  assert.deepEqual(intent.destination, point(800, 50));
});
check('autonomy falls through support, search and patrol in order', () => {
  const base = {
    retreatDestination: null, attacker: null, engagement: null, beaconDestination: null, mission: null,
    knownEnemy: null, fightingAlly: { id: 3, destination: point(400, 10) },
    forwardSearch: point(900, 0), patrolPoint: point(0, 0),
  };
  assert.equal(resolveFleetIntent(base).kind, 'support');
  assert.equal(resolveFleetIntent({ ...base, fightingAlly: null }).kind, 'search');
  assert.equal(resolveFleetIntent({ ...base, fightingAlly: null, forwardSearch: null }).kind, 'patrol');
});

console.log('\n=== Battle movement/fire integration ===');
const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
check('[v72] engaging fleet decouples fire control from hull heading', () => {
  // [v72 契约订正 2026-10-04] 旧金标锁「交战中 fAngle 必须朝敌」，那正是 v72 改掉的病根：
  //   _probe_heading3.mjs 场景2 实测该分支让 facingSmooth 在 100 帧内回转 90°
  //   ⇒ 阵型跟着甩 ⇒ 用户实报「阵型指向右下但移动往右上」「战舰瞬间换个方向」。
  // 新契约：交战中**火控解算独立**（_fireControlAngle，供炮塔消费），
  //   舰首保持停船时的航向，不再被火控拉扯。
  assert.match(sceneSource,
    /if \(isEngaging && closestEnemyFleet\)[\s\S]{0,900}_fireControlAngle = _fireAngle/);
  // 负向守卫：该分支内**不得**再写 fleet.facingAngle（否则舰首又被火控拖走）
  const fireBranch = sceneSource.match(/if \(isEngaging && closestEnemyFleet\)[\s\S]{0,1400}?\n {12}\}/);
  assert.ok(fireBranch, '交战分支存在');
  assert.doesNotMatch(fireBranch[0], /fleet\.facingAngle = _fireAngle/,
    'fire-control branch must not write fleet.facingAngle (v72 decoupling)');
  // 火控解算必须落库存（供 30 号 §5 炮塔层消费）
  assert.match(sceneSource, /_fireControlAngle/);
}
);
check('legacy contract is not silently restored (facingAngle must not be re-bound to the enemy)', () => {
  // 负向守卫必须**只看该分支内部**：早先用 {0,900} 窗口会一路吃到下一个代码块
  // 里的合法 `fleet.facingAngle = fAngle`（distToTarget>5 分支）⇒ 误报。
  // 正确做法：先截出分支体，再在体内做否定匹配。
  const fireBranch = sceneSource.match(
    /if \(isEngaging && closestEnemyFleet\) \{[\s\S]{0,1400}?\n {12}\}/);
  assert.ok(fireBranch, '交战分支存在');
  assert.doesNotMatch(fireBranch[0], /fleet\.facingAngle = fAngle/,
    'v71 fire-control coupling must stay removed inside the engaging branch');
  // 同时确认 distToTarget>5 分支仍保留原有的 facingAngle 写入（未被误伤）。
  // 窗口需 ≥ 实测距离（BattleScene 中两处相距约 700+ 字符）。
  assert.match(sceneSource, /distToTarget > 5[\s\S]{0,1200}fleet\.facingAngle = fAngle/);
  // [v74 契约订正 2026-10-14] **舰首朝向 = 舰队姿态，始终**。
  //
  // 旧契约（v47~v73）：`_wantH = atan2(_dy,_dx)` 用自身位移差分求舰首方向，
  //   并用 `_rigid` 在拖刀/掉头/近静止时例外锁舰队朝向。
  // 为什么废弃（用户实报「近景各种朝向的舰船都有，朝向乱七八糟」）：
  //   刚体模型下每舰位移 = 中心位移 + **旋转分量**，两者方向不同：
  //     ① 紧凑转压缩 lateral ⇒ 每舰产生与舰队朝向**垂直**的位移
  //     ② 推力硬上限 ⇒ 惯性滑行（中心速度旧方向 ≠ 队列姿态新方向）
  //     ③ 每舰位置不同 ⇒ 旋转分量不同 ⇒ **每舰朝向各不相同**
  // 新契约：舰首朝向直接取舰队姿态 `facingSmooth`（刚体 heading）。
  //   战舰允许惯性滑行（速度 ≠ 舰首方向）—— 这是"重"的体现，不是要修的侧滑。
  assert.match(sceneSource, /const _wantH = fleet\.facingSmooth \?\? fleet\.facingAngle \?\? fAngle;/);
  // 负向守卫：位移差分路径必须彻底移除（回退即"朝向乱"复发）
  assert.doesNotMatch(sceneSource, /_wantH\s*=\s*\(_rigid[\s\S]{0,80}Math\.atan2\(_dy, _dx\)/,
    'displacement-diff heading path must stay removed (v74)');
  assert.doesNotMatch(sceneSource, /const _rigid = /,
    '_rigid block must stay removed (v74: no per-ship rigid exception needed)');
});
check('capture mission ignores objectives already owned by an allied faction', () => {
  const missionBody = sceneSource.slice(sceneSource.indexOf("m.type === 'capture_planet'"), sceneSource.indexOf("m.type === 'hold_point'"));
  assert.match(missionBody, /ownerFac[^\n]*team[^\n]*fac\.team/);
});

console.log(`\n${passed} fleet-intent assertions passed`);
