/** End-to-end source/behavior contracts found by the post-implementation audit. */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const tactical = require('../frontend/src/game/TacticalCommandSystem.ts');
const command = require('../frontend/src/game/battle/CommandSystem.ts');
const taskForce = require('../frontend/src/game/taskForce.ts');
const authority = require('../frontend/src/game/battle/CommandAuthority.ts');
const scout = require('../frontend/src/game/battle/ScoutSystem.ts');

const scene = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
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

console.log('\n=== Direct-command runtime authority ===');
check('a successor fleet is controllable by commander authority even when its faction is AI', () =>
  tactical.isDirectCommandAllowed(
    { commanderId: 22, units: [{ hp: 10, classType: '战列' }] },
    22,
  ) === true);
check('BattleScene consumes commander authority instead of faction.type for direct control', () => {
  const block = scene.slice(scene.indexOf('private canDirectlyControlFleet'), scene.indexOf('private findHostileFleetNear'));
  return block.includes('isDirectCommandAllowed') && !block.includes("fac.type === 'player'");
});
check('succession candidates are limited to formal combat fleets', () => {
  const block = scene.slice(scene.indexOf('private checkSupremeSuccession'), scene.indexOf('private spawnSupplyRelayPlanets'));
  return block.includes('isFormalCommandFleet(fl)') && !block.includes('fl.units && fl.units.length > 0');
});

check('initial supreme-commander election ignores scouts and temporary detachments', () => {
  const start = scene.indexOf('private computeSupremeCommander()');
  const end = scene.indexOf('private checkSupremeSuccession()', start);
  const block = scene.slice(start, end);
  return block.includes('!isFormalCommandFleet(fl)');
});
check('the supreme fleet bypasses relay delay and channel saturation', () => {
  const block = scene.slice(scene.indexOf('private passOrderBandwidthGate'), scene.indexOf('private commitDirectOrder'));
  return /commanderId\s*===\s*this\.supremeCommanderId/.test(block) && block.indexOf('commanderId') < block.indexOf('getLinkStatus');
});

console.log('\n=== Right-click target integrity ===');
check('3D right-click first picks the visible fleet under the cursor', () => {
  const block = overlay.slice(overlay.indexOf('private handlePick'), overlay.indexOf('public pickFleetAtScreen'));
  return /button\s*===\s*2[\s\S]*pickFleetAtScreen/.test(block)
    && block.includes('orderSelectedFleetAttackById');
});
check('2D proximity fallback cannot select a hidden hostile', () => {
  const block = scene.slice(scene.indexOf('private findHostileFleetNear'), scene.indexOf('private passOrderBandwidthGate'));
  return block.includes("_intelDisplayMode !== 'live'");
});
check('direct pursuit uses archived coordinates when the target is outside live vision', () => {
  const block = scene.slice(scene.indexOf('// —— direct attack tick'), scene.indexOf('const w1JustIssued'));
  return block.includes('const w1LiveVisible')
    && block.includes('lastKnown: w1LiveVisible')
    && !/lastKnown:\s*w1Tgt\s*\?/.test(block);
});
check('direct attack fire control cannot shoot the real hidden target at its live coordinates', () => {
  const block = scene.slice(scene.indexOf('const attackTargetFleet'), scene.indexOf('// ═══ [W1] 撤退运行时三态'));
  return block.includes("(ef as any)._intelDisplayMode === 'live'");
});
check('fire control rejects targets outside the visible forward firing arc', () =>
  authority.isTargetWithinFireArc(0, { x: 0, y: 0 }, { x: 100, y: 0 }) === true
  && authority.isTargetWithinFireArc(0, { x: 0, y: 0 }, { x: -100, y: 0 }) === false
  && scene.includes('isTargetWithinFireArc('));
check('fire control filters the candidate pool by arc before scored selection', () => {
  // [P1] 选舰由均匀随机改为 clusterAI.pickShip 评分（含滞回）；本断言钉的契约不变：
  //   **射界过滤必须发生在选舰之前**（先选后拒会因随机候选在舰尾而误压有效射击）。
  // v8：候选池取数改走 `this.targetableUnitsOf(...)`（= 目标舰队战斗舰 + 该阵营运输舰），
  //   契约（先射界过滤、再评分选舰）不变 —— 故这里只钉 `inRangeUnits =` 到 `pickShip(_cands` 之间。
  const start = scene.indexOf('const inRangeUnits = this.targetableUnitsOf(fireTargetFleet).filter');
  const scoredPick = scene.indexOf('pickShip(_cands', start);
  const block = scene.slice(start, scoredPick);
  return start >= 0 && scoredPick > start && block.includes('isTargetWithinFireArc(');
});

console.log('\n=== Intent labels ===');
check('authority intent labels are normalized without duplicate prefixes', () =>
  tactical.formatAuthorityIntent('local_combat_response', '交战：压制敌前卫') === '交战：压制敌前卫'
  && tactical.formatAuthorityIntent('autonomous_posture', '警戒') === '临机：警戒'
  && tactical.formatAuthorityIntent('strategic_mission', '进击敌舰队') === '奉令：进击敌舰队');
check('BattleScene passes authDecision.layer to the intent formatter', () =>
  scene.includes('formatAuthorityIntent(authDecision.layer, authDecision.label)'));

console.log('\n=== Recon and battle reset lifecycle ===');
check('recon launch iterates active factions even when the detachment map starts empty', () => {
  const block = scene.slice(scene.indexOf('private tickReconScouts'), scene.indexOf('private emitScoutNotice'));
  return block.includes('this.store.factions') && block.includes('this.launchScoutForFaction');
});
check('recon launch is capped per team so several admirals do not multiply scout visuals', () => {
  const launch = scene.slice(scene.indexOf('private launchScoutForFaction'), scene.indexOf('private createScoutFlightRuntime'));
  const tick = scene.slice(scene.indexOf('private tickReconScouts'), scene.indexOf('private emitScoutNotice'));
  return launch.includes('this.scoutDetachments.get(fac.team)')
    && launch.includes('this.scoutDetachments.set(fac.team')
    && tick.includes('const launchedTeams = new Set<number>()');
});
check('a new battle clears transient intel, destroyed ids, scouts, and terminal flags', () =>
  scene.includes('private resetBattleRuntimeState')
  && scene.includes('this.resetBattleRuntimeState()')
  && scene.includes('this.intelArchive = createIntelArchive()')
  && scene.includes('this.destroyedFleetIds.clear()')
  && scene.includes('this.scoutDetachments.clear()')
  && scene.includes('this.battleResolutionStarted = false'));
check('the game store is initialized before battle reset reads faction state', () => {
  const block = scene.slice(scene.indexOf('create() {'), scene.indexOf('const state ='));
  return block.indexOf('this.store = useGameStore()') < block.indexOf('this.resetBattleRuntimeState()');
});
check('ordinary positive identification writes the persistent team intel archive', () => {
  const block = scene.slice(scene.indexOf('// 2. 战争迷雾'), scene.indexOf('// 2.5 隐身检测'));
  return block.includes("if (memState === 'identified' && (rawObserved === 'identified' || inExchange))")
    && block.includes('this.markFleetIdentified(playerFac.team, fl)');
});
check('EW track break is propagated through the scout hostile snapshot', () =>
  scene.includes('trackReliable: (ef as any)._trackReliable !== false')
  && scene.includes('tracked.trackReliable === false'));
check('scout launch heading does not consume unseen hostile fleet coordinates', () => {
  const block = scene.slice(scene.indexOf('private launchScoutForFaction'), scene.indexOf('private createScoutFlightRuntime'));
  return block.includes('getKnownContact(this.intelArchive, fac.team, ef.id)')
    && block.includes('Math.atan2(-launchOrigin.y, -launchOrigin.x)');
});
check('team scouts launch from the team deployment centre rather than one admiral base', () => {
  const block = scene.slice(scene.indexOf('private launchScoutForFaction'), scene.indexOf('private createScoutFlightRuntime'));
  return block.includes('teamFleets') && block.includes('launchOrigin')
    && block.includes('x: launchOrigin.x, y: launchOrigin.y');
});
check('a team with no prior contact launches reconnaissance at battle opening', () =>
  scout.shouldLaunchScouts({ now: 0, lastContactAt: 0, cooldownUntil: 0, liveFlightCount: 0 }) === true);
check('an active scout track feeds live fleet identification into the fog calculation', () => {
  const start = scene.indexOf('// Active scout tracks are first-class team sensors');
  const end = scene.indexOf('rawObserved = contact.state', start);
  const block = scene.slice(start, end);
  return block.includes('this.scoutDetachments') && block.includes('track.contactId !== fl.id')
    && block.includes('scoutReport,') && block.includes('scoutDistance <= track.sensorRange');
});
check('a tracking scout refreshes the persistent record as its target moves', () => {
  const start = scene.indexOf('private tickReconScouts');
  const end = scene.indexOf('private emitScoutNotice', start);
  const block = scene.slice(start, end);
  return /res\.flight\.phase === 'tracking'[\s\S]*recordKnownContact/.test(block);
});
check('electronic warfare has an execution path after its command permission gate', () => {
  const start = scene.indexOf('private setupCommandDispatcher');
  const end = scene.indexOf('private scaleMapForFleetCount', start);
  const block = scene.slice(start, end);
  return block.includes("type === 'stance' || type === 'electronic'")
    && block.includes("classType === '电子'")
    && block.includes("const stance = type === 'electronic' ? 'electronic' : payload")
    && block.includes('this.applyStanceToFleet(fleet, stance)');
});
check('the redundant manual scout button is removed from the fleet billboard', () =>
  !/for \(const stance of \['search', 'scout'/.test(overlay));
check('friendly command controls are shown only for the current directly controllable fleet', () =>
  overlay.includes('controlsEl') && overlay.includes('battleSelectedFleetId')
    && overlay.includes('canDirectlyControlFleet'));
check('fleet billboards carry health, supply, and morale as three uniform status bars', () =>
  overlay.includes('moraleFill') && overlay.includes('lastMorale')
    && (overlay.match(/className = 'b3d-bb-bar'/g) || []).length >= 3);

console.log('\n=== Fleet loss and tactical-plan qualification ===');
check('losing one detachment does not deactivate a faction with another combat fleet', () =>
  command.shouldDeactivateFactionAfterFleetLoss([
    { id: 1, factionId: 8, units: [] },
    { id: 2, factionId: 8, units: [{ hp: 50, classType: '巡洋' }] },
  ], 8, 1) === false
  && command.shouldDeactivateFactionAfterFleetLoss([
    { id: 1, factionId: 8, units: [] },
  ], 8, 1) === true);
check('flagship loss handling uses persistent identity rather than mutable units[0]', () => {
  const block = scene.slice(scene.indexOf('fleet.units = fleet.units.filter'), scene.indexOf('// [v59/v60]', scene.indexOf('fleet.units = fleet.units.filter')));
  return block.includes('u.isFlagship === true') && !block.includes('fleet.units[0] === u');
});
check('multi-route AI plans require contact, space, condition, and coordination', () =>
  taskForce.canCommitMultiRoutePlan({
    combatUnits: 8, hpPct: 0.9, lateralSpace: 500, contactQuality: 0, commandDegraded: false,
  }).ok === false
  && taskForce.canCommitMultiRoutePlan({
    combatUnits: 8, hpPct: 0.9, lateralSpace: 500, contactQuality: 2, commandDegraded: false,
  }).ok === true
  && scene.includes('evalSplitEligibility(strongest, true)')
  && scene.includes('canCommitMultiRoutePlan(input)'));
check('generic mission roles are not promoted into committed tactical-plan authority', () => {
  const block = scene.slice(scene.indexOf('const w1PlanRoleSource'), scene.indexOf('const authDecision'));
  return block.includes('_maneuverCommitted') && !block.includes('|| (fleet as any)._planRole');
});
check('new detachments do not instantly rejoin merely because they use a tactical role instead of a mission', () =>
  scene.includes('_detachObjectiveDone: false')
  && scene.includes('objectiveDone: (kid as any)._detachObjectiveDone === true'));


// ── [v86] 受击方引用守卫（防 update 抛异常 ⇒ **全场停摆**）─────────────────
//   用户实报「舰队突然卡住不动」+ 控制台
//   `Cannot read properties of null (reading '_formationCollapsed')`
//   ⇒ 在 `if (targetShip)` 块内访问了 closestEnemyFleet，
//     而它在 return_fire 模式下可为 null（受击方是 attackerFleet）
//   ⇒ 抛异常 ⇒ BattleScene.update 中断 ⇒ 所有舰队停止移动（UI 仍有反应）。
//   守卫：该块内**只允许** fireTargetFleet（受击方），不得出现 closestEnemyFleet 属性访问。
{
  const src = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
  const lines = src.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('if (targetShip) {')) { start = i; break; }
  }
  check('受击方块存在（口径基准）', () => start >= 0, String(start));
  if (start >= 0) {
    const base = (lines[start].match(/^\s*/) || [''])[0].length;
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)\}/);
      if (m && m[1].length === base) { end = i; break; }
    }
    check('受击方块能定位到结束（口径基准）', () => end > start, String(end));
    const hits = [];
    for (let i = start; i <= end; i++) {
      if (lines[i].trim().startsWith('//')) continue;
      if (lines[i].includes('closestEnemyFleet.')) hits.push(i + 1);
    }
    check('受击方块内不得访问 closestEnemyFleet（防 null 崩溃 + 语义错）',
      () => hits.length === 0, hits.join(','));
    let usesFireTarget = 0;
    for (let i = start; i <= end; i++) if (lines[i].includes('fireTargetFleet')) usesFireTarget++;
    check('受击方块确实消费 fireTargetFleet（受击方语义）', () => usesFireTarget >= 3, String(usesFireTarget));
  }
}

// ── [v87] 主循环异常隔离守卫 ────────────────────────────────────────────
//   背景（v86）：update 内单点 null 访问抛异常 ⇒ update 中断 ⇒ 全场停摆
//   （UI 有反应说明是异常中断而非逻辑卡死）。
//   要求：主循环有 try/catch 兜底，且异常**照常打日志**（不掩盖根因）。
{
  const src = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
  check('主循环存在单舰队异常隔离（try/catch）',
    () => /单舰队异常隔离（主循环）/.test(src) && /catch \(fleetTickErr\)/.test(src));
  check('隔离处调用 reportTickError 记账',
    () => /this\.reportTickError\(fleet, fleetTickErr\)/.test(src));
  check('reportTickError 用 console.error 输出（不掩盖根因）',
    () => /private reportTickError[\s\S]{0,900}console\.error/.test(src));
  check('reportTickError 有 2s 节流（防刷屏）',
    () => /_tickErrLastAt[\s\S]{0,240}> 2000/.test(src));
}
process.stdout.write(`\nbattleFlowAuditSim: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
