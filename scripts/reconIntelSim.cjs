/**
 * W2 侦察生命周期 + 迷雾情报持久档案 —— 确定性行为契约测试台
 *
 * 模式与 commandAuthoritySim.cjs / directOrderSim.cjs 一致：
 *   · 行为断言：require 纯函数模块（ScoutSystem.ts / IntelSystem.js / BattleTransientFields.ts）直接判；
 *   · 源码契约断言：对 BattleScene.ts / Battle3DOverlay.ts / gameStore.ts 的字符串/正则检查
 *     （仅作弱补充——渲染/集成层的行为靠行为断言 + vue-tsc 兜底）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const scout = require('../frontend/src/game/battle/ScoutSystem.ts');
const intel = require('../frontend/src/game/battle/IntelSystem.js');
const transient = require('../frontend/src/game/battle/BattleTransientFields.ts');

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

// ============================================================
// 一、通知仅 4 类（design §Reconnaissance lifecycle 末段）
// ============================================================
console.log('\n=== 侦察通知四分类（例行事件抑制） ===');
check('例行放飞/返航/扇区扫描一律不发全局通知', () => {
  assert.equal(scout.classifyScoutNotice({ event: 'launch' }), null);
  assert.equal(scout.classifyScoutNotice({ event: 'return' }), null);
  assert.equal(scout.classifyScoutNotice({ event: 'sector_sweep' }), null);
});
check('首次确认接触 ⇒ first_contact', () => {
  assert.equal(scout.classifyScoutNotice({ event: 'contact', firstForTarget: true }), 'first_contact');
});
check('非首次接触且无重大变化 ⇒ 抑制通知', () => {
  assert.equal(scout.classifyScoutNotice({ event: 'contact', firstForTarget: false, materialChange: false }), null);
});
check('敌兵力/方位重大变化 ⇒ strength_change', () => {
  assert.equal(scout.classifyScoutNotice({ event: 'contact', firstForTarget: false, materialChange: true }), 'strength_change');
  assert.equal(scout.classifyScoutNotice({ event: 'strength_change', materialChange: true }), 'strength_change');
  assert.equal(scout.classifyScoutNotice({ event: 'strength_change', materialChange: false }), null);
});
check('侦察损失 / 重要航迹丢失 ⇒ scout_loss / track_lost', () => {
  assert.equal(scout.classifyScoutNotice({ event: 'scout_loss' }), 'scout_loss');
  assert.equal(scout.classifyScoutNotice({ event: 'track_lost' }), 'track_lost');
});

// ============================================================
// 二、阵营级侦察分队：上限 / 跟踪指派 / 跟踪优先级
// ============================================================
console.log('\n=== 阵营级侦察分队生命周期 ===');
check('一次放飞 = 左/中/右三机，分队视觉上限 = 3', () => {
  assert.equal(scout.SCOUT_FLIGHTS_PER_DETACHMENT, 3);
  const flights = scout.launchScoutFlights({
    parentFleetId: 1, factionId: 2, team: 2, x: 0, y: 0,
    heading: 0, parentSpeed: 1, now: 1000,
  });
  assert.equal(flights.length, 3);
  assert.deepEqual(flights.map(f => f.sector), ['left', 'centre', 'right']);
});
check('放飞策略按阵营汇总状态判定，与舰队数无关（在途即不放飞）', () => {
  assert.equal(scout.shouldLaunchScouts({ now: 60000, lastContactAt: 0, cooldownUntil: 0, liveFlightCount: 3 }), false);
  assert.equal(scout.shouldLaunchScouts({ now: 60000, lastContactAt: 0, cooldownUntil: 0, liveFlightCount: 0 }), true);
});
check('跟踪指派：最佳位置（最近）的机接手，阵亡者跳过', () => {
  const contact = { x: 100, y: 0 };
  assert.equal(scout.selectScoutTracker([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 80, y: 0 }], contact), 'b');
  assert.equal(scout.selectScoutTracker([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 80, y: 0, hp: 0 }], contact), 'a');
  assert.equal(scout.selectScoutTracker([], contact), null);
});
check('未被指派的机不抢跟踪（不重复建立航迹）', () => {
  const base = scout.launchScoutFlights({
    parentFleetId: 1, factionId: 2, team: 2, x: 0, y: 0,
    heading: 0, parentSpeed: 1, now: 1000, sensorRange: 500,
  })[1];
  const result = scout.advanceScoutFlight({ ...base, x: 0, y: 0 }, {
    now: 2000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true },
    hostiles: [{ id: 99, x: 200, y: 0, alive: true }],
    trackerId: 'someone-else',
  });
  assert.equal(result.report, null);
  assert.equal(result.flight.contactId, null);
});
check('被指派的机建立航迹并转入 tracking', () => {
  const base = scout.launchScoutFlights({
    parentFleetId: 1, factionId: 2, team: 2, x: 0, y: 0,
    heading: 0, parentSpeed: 1, now: 1000, sensorRange: 500,
  })[1];
  const result = scout.advanceScoutFlight({ ...base, x: 0, y: 0 }, {
    now: 2000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true },
    hostiles: [{ id: 99, x: 200, y: 0, alive: true }],
    trackerId: base.id,
  });
  assert.equal(result.report?.targetId, 99);
  assert.equal(result.flight.phase, 'tracking');
  assert.equal(result.flight.contactId, 99);
});
check('移交友军传感器 ⇒ 跟踪安静结束（不发 track_lost 通知）', () => {
  const tracking = {
    id: 's1', parentFleetId: 1, factionId: 2, team: 2, sector: 'centre',
    x: 0, y: 0, originX: 0, originY: 0, heading: 0, speed: 220, hp: 100, maxHp: 100,
    sensorRange: 500, weaponRange: 180, phase: 'tracking', launchedAt: 0,
    maxForwardDistance: 900, contactId: 99,
  };
  const result = scout.advanceScoutFlight(tracking, {
    now: 3000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true },
    hostiles: [{ id: 99, x: 200, y: 0, alive: true }],
    contactHandoff: true,
  });
  assert.equal(result.trackLost, false);
  assert.equal(result.flight.phase, 'returning');
  assert.equal(result.flight.contactId, null);
});
check('反情报/电子战显式失效航迹 ⇒ trackLost（重要航迹丢失）', () => {
  const tracking = {
    id: 's1', parentFleetId: 1, factionId: 2, team: 2, sector: 'centre',
    x: 0, y: 0, originX: 0, originY: 0, heading: 0, speed: 220, hp: 100, maxHp: 100,
    sensorRange: 500, weaponRange: 180, phase: 'tracking', launchedAt: 0,
    maxForwardDistance: 900, contactId: 99,
  };
  const broken = scout.advanceScoutFlight(tracking, {
    now: 3000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true },
    hostiles: [{ id: 99, x: 200, y: 0, alive: true }],
    trackBroken: true,
  });
  assert.equal(broken.trackLost, true);
  // 目标消失（非移交）同样算重要航迹丢失
  const vanished = scout.advanceScoutFlight(tracking, {
    now: 3000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true },
    hostiles: [],
  });
  assert.equal(vanished.trackLost, true);
});
check('被跟踪接触保持为优先目标（持续跟踪而非回扫描）', () => {
  const tracking = {
    id: 's1', parentFleetId: 1, factionId: 2, team: 2, sector: 'centre',
    x: 0, y: 0, originX: 0, originY: 0, heading: 0, speed: 220, hp: 100, maxHp: 100,
    sensorRange: 500, weaponRange: 180, phase: 'tracking', launchedAt: 0,
    maxForwardDistance: 900, contactId: 99,
  };
  const result = scout.advanceScoutFlight(tracking, {
    now: 3000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true },
    hostiles: [{ id: 99, x: 600, y: 0, alive: true }],
  });
  assert.equal(result.flight.phase, 'tracking');
  assert.equal(result.flight.contactId, 99);
  assert.ok(result.flight.x > 0, '应朝被跟踪目标机动');
});
check('侦察损失带 scoutLost 信号（供 classifyScoutNotice 消费）', () => {
  const dying = {
    id: 's1', parentFleetId: 1, factionId: 2, team: 2, sector: 'centre',
    x: 0, y: 0, originX: 0, originY: 0, heading: 0, speed: 220, hp: 0, maxHp: 100,
    sensorRange: 500, weaponRange: 180, phase: 'outbound', launchedAt: 0,
    maxForwardDistance: 900, contactId: null,
  };
  const result = scout.advanceScoutFlight(dying, {
    now: 3000, deltaSeconds: 1, parent: { x: 0, y: -100, alive: true }, hostiles: [],
  });
  assert.equal(result.scoutLost, true);
  assert.equal(result.flight.phase, 'lost');
});

// ============================================================
// 三、持久已知目标档案（design §Fog：persistent known-object record）
// ============================================================
console.log('\n=== 持久情报档案（无 TTL） ===');
check('确认识别 ⇒ 档案记录含末次确认位置 + 时间', () => {
  const archive = intel.createIntelArchive();
  assert.equal(intel.getKnownContact(archive, 1, 42), null);
  const rec = intel.recordKnownContact(archive, {
    team: 1, targetId: 42, kind: 'fleet', x: 100, y: 200, now: 5000, strength: 4,
  });
  assert.equal(rec.x, 100);
  assert.equal(rec.y, 200);
  assert.equal(rec.t, 5000);
  assert.equal(rec.strength, 4);
  assert.equal(rec.reliable, true);
  const got = intel.getKnownContact(archive, 1, 42);
  assert.equal(got?.firstConfirmedAt, 5000);
});
check('再次确认只推进末次位置/时间，保留首次确认时间（档案持久不重建）', () => {
  const archive = intel.createIntelArchive();
  intel.recordKnownContact(archive, { team: 1, targetId: 42, kind: 'fleet', x: 0, y: 0, now: 1000, strength: 3 });
  const rec = intel.recordKnownContact(archive, { team: 1, targetId: 42, kind: 'fleet', x: 900, y: 0, now: 9000 });
  assert.equal(rec.firstConfirmedAt, 1000);
  assert.equal(rec.x, 900);
  assert.equal(rec.t, 9000);
  assert.equal(rec.strength, 3, '未给新兵力估计时沿用旧值');
});
check('档案按团队域隔离', () => {
  const archive = intel.createIntelArchive();
  intel.recordKnownContact(archive, { team: 1, targetId: 42, kind: 'fleet', x: 0, y: 0, now: 1000 });
  assert.equal(intel.getKnownContact(archive, 2, 42), null);
});
check('显式失效（唯一入口效果）⇒ reliable=false 但档案保留', () => {
  const archive = intel.createIntelArchive();
  intel.recordKnownContact(archive, { team: 1, targetId: 42, kind: 'fleet', x: 0, y: 0, now: 1000 });
  const broken = intel.invalidateKnownTrack(archive, 1, 42);
  assert.equal(broken?.reliable, false);
  assert.equal(intel.isKnownTrackReliable(archive, 1, 42), false);
  assert.ok(intel.getKnownContact(archive, 1, 42), '档案不得因失效而删除');
});
check('重新确认 ⇒ 可靠航迹重建', () => {
  const archive = intel.createIntelArchive();
  intel.recordKnownContact(archive, { team: 1, targetId: 42, kind: 'fleet', x: 0, y: 0, now: 1000 });
  intel.invalidateKnownTrack(archive, 1, 42);
  intel.recordKnownContact(archive, { team: 1, targetId: 42, kind: 'fleet', x: 10, y: 10, now: 2000 });
  assert.equal(intel.isKnownTrackReliable(archive, 1, 42), true);
});
check('固定基地档案（kind=base）确认后常驻', () => {
  const archive = intel.createIntelArchive();
  intel.recordKnownContact(archive, { team: 1, targetId: 'base:2', kind: 'base', x: 300, y: 300, now: 4000, strength: null });
  const rec = intel.getKnownContact(archive, 1, 'base:2');
  assert.equal(rec?.kind, 'base');
  assert.equal(rec?.reliable, true);
});

// ============================================================
// 四、交战中不可消失 + 降档唯一入口
// ============================================================
console.log('\n=== 交战窗口与接触记忆 ===');
check('开火/交战中强制战斗接触，观测掉档也不消失', () => {
  assert.equal(intel.resolveContactMemory({
    previous: 'anomaly', observed: 'unknown', fired: false, engaged: true, concealmentSucceeded: false,
  }), 'identified');
  assert.equal(intel.resolveContactMemory({
    previous: 'identified', observed: 'unknown', fired: true, engaged: true, concealmentSucceeded: true,
  }), 'identified', '交战窗口内即使电子战也不可把它藏回去');
});
check('普通离开视野/距离损失不降级（已确认记忆单调保持）', () => {
  assert.equal(intel.resolveContactMemory({
    previous: 'identified', observed: 'unknown', fired: false, engaged: false, concealmentSucceeded: false,
  }), 'identified');
});
check('唯一降档入口：交战结束后显式电子战/欺骗成功', () => {
  assert.equal(intel.resolveContactMemory({
    previous: 'identified', observed: 'unknown', fired: false, engaged: false, concealmentSucceeded: true,
  }), 'unknown');
});

// ============================================================
// 五、渲染档位（live / fuzzy / last_known / hidden）
// ============================================================
console.log('\n=== 情报渲染档位 ===');
const record = { x: 640, y: 360, t: 8000, reliable: true, kind: 'fleet' };
check('交战窗口/实时确认 ⇒ live', () => {
  assert.equal(intel.resolveIntelDisplay({ observed: 'unknown', engaged: true, record }).mode, 'live');
  assert.equal(intel.resolveIntelDisplay({ observed: 'identified', record }).mode, 'live');
  assert.equal(intel.resolveIntelDisplay({ observed: 'contact', identified: true, record }).mode, 'live',
    '档案已知目标被实时重捕获 ⇒ live');
});
check('未识别模糊接触 ⇒ fuzzy（异常信号 / 未识别舰队）', () => {
  const anomaly = intel.resolveIntelDisplay({ observed: 'anomaly', record });
  assert.equal(anomaly.mode, 'fuzzy');
  assert.equal(anomaly.label, '异常信号');
  const contact = intel.resolveIntelDisplay({ observed: 'contact', record });
  assert.equal(contact.mode, 'fuzzy');
  assert.equal(contact.label, '未识别舰队');
});
check('实时视野外的已知舰队 ⇒ 末次位置情报接触（画在档案坐标，绝不实时跟位）', () => {
  const d = intel.resolveIntelDisplay({ observed: 'unknown', record });
  assert.equal(d.mode, 'last_known');
  assert.equal(d.label, '末次位置');
  assert.equal(d.x, 640);
  assert.equal(d.y, 360);
  assert.equal(d.t, 8000);
});
check('航迹失效 / 无档案 ⇒ hidden（不渲染）', () => {
  assert.equal(intel.resolveIntelDisplay({ observed: 'unknown', record: { ...record, reliable: false } }).mode, 'hidden');
  assert.equal(intel.resolveIntelDisplay({ observed: 'unknown', record: null }).mode, 'hidden');
});
check('重大变化判定：兵力 Δ≥2 或位移 ≥ 阈值', () => {
  assert.equal(intel.isMaterialIntelChange(null, { x: 0, y: 0 }), false);
  assert.equal(intel.isMaterialIntelChange({ x: 0, y: 0, strength: 3 }, { x: 0, y: 0, strength: 5 }), true);
  assert.equal(intel.isMaterialIntelChange({ x: 0, y: 0, strength: 3 }, { x: 0, y: 0, strength: 4 }), false);
  assert.equal(intel.isMaterialIntelChange({ x: 0, y: 0 }, { x: 700, y: 0 }), true);
  assert.equal(intel.isMaterialIntelChange({ x: 0, y: 0 }, { x: 100, y: 0 }), false);
  assert.equal(intel.isMaterialIntelChange({ x: 0, y: 0 }, { x: 200, y: 0, moveThreshold: 150 }), true);
});

// ============================================================
// 六、存档卫生（W1/W2 运行时字段不入档）
// ============================================================
console.log('\n=== 存档序列化卫生 ===');
check('序列化 replacer 剥离战斗瞬态字段', () => {
  assert.equal(transient.battleTransientJsonReplacer('directOrder', { type: 'attack' }), undefined);
  assert.equal(transient.battleTransientJsonReplacer('_intelArchive', { records: [] }), undefined);
  assert.deepEqual(transient.battleTransientJsonReplacer('composition', { cruisers: 3 }), { cruisers: 3 });
});
check('读档剥离：深拷贝剔除瞬态字段并保留正常数据', () => {
  const polluted = {
    strategicFleets: [{
      id: 7, fleetNumber: 3,
      retreatState: 'routing', directOrder: { type: 'attack' }, attackState: 'engaging',
      _stall: { t: 1 }, _trackReliable: false, _identifiedByTeams: [1], _intelArchive: { records: [] },
      _scoutReports: [], _intelDisplayMode: 'last_known', _intelLastKnown: { x: 1, y: 2, t: 3 },
    }],
  };
  const clean = transient.stripBattleTransientFields(polluted);
  const fleet = clean.strategicFleets[0];
  assert.equal(fleet.id, 7);
  assert.equal(fleet.fleetNumber, 3);
  for (const key of ['retreatState', 'directOrder', 'attackState', '_stall', '_trackReliable',
    '_identifiedByTeams', '_intelArchive', '_scoutReports', '_intelDisplayMode', '_intelLastKnown']) {
    assert.equal(key in fleet, false, `存档不应含 ${key}`);
  }
  const viaJson = JSON.parse(JSON.stringify(polluted, transient.battleTransientJsonReplacer));
  assert.equal('retreatState' in viaJson.strategicFleets[0], false);
  assert.equal(viaJson.strategicFleets[0].id, 7);
});

// ============================================================
// 七、BattleScene / Battle3DOverlay 源码契约（弱补充）
// ============================================================
console.log('\n=== 战斗集成源码契约（弱补充） ===');
const sceneSource = fs.readFileSync('./frontend/src/game/scenes/BattleScene.ts', 'utf8');
const overlaySource = fs.readFileSync('./frontend/src/game/three/Battle3DOverlay.ts', 'utf8');
const storeSource = fs.readFileSync('./frontend/src/store/gameStore.ts', 'utf8');
const transientSource = fs.readFileSync('./frontend/src/game/battle/BattleTransientFields.ts', 'utf8');
const commandSource = fs.readFileSync('./frontend/src/game/battle/CommandAuthority.ts', 'utf8');

check('侦察收敛阵营级：放飞锚为阵营（scoutDetachments），旧的舰队级入口已删除', () => {
  assert.match(sceneSource, /scoutDetachments/);
  assert.match(sceneSource, /launchScoutForFaction/);
  assert.doesNotMatch(sceneSource, /launchScoutFromFleet/);
});
check('例行放飞不发全局 toast（通知抑制落地）', () => {
  const launchBody = sceneSource.slice(
    sceneSource.indexOf('private launchScoutForFaction'),
    sceneSource.indexOf('private createScoutFlightRuntime'),
  );
  assert.doesNotMatch(launchBody, /triggerToast/);
  assert.doesNotMatch(sceneSource, /triggerToast[^\n]*出发/);
  assert.doesNotMatch(sceneSource, /triggerToast[^\n]*返航/);
});
check('侦察通知只落在 4 类文案上', () => {
  assert.match(sceneSource, /classifyScoutNotice\(\{/);
  assert.match(sceneSource, /首次确认/);
  assert.match(sceneSource, /重大变化/);
  assert.match(sceneSource, /侦察损失/);
  assert.match(sceneSource, /重要航迹丢失/);
});
check('搜索航线前向化 + 分队上限常量被消费', () => {
  const launchBody = sceneSource.slice(
    sceneSource.indexOf('private launchScoutForFaction'),
    sceneSource.indexOf('private createScoutFlightRuntime'),
  );
  assert.match(launchBody, /resolveScoutForwardHeading/);
  assert.match(launchBody, /SCOUT_FLIGHTS_PER_DETACHMENT/);
  // 放飞航向 = 战线前向（scoutHeading），不是母舰舰首朝向（facingSmooth 仅作 currentHeading 回退入参）
  assert.match(launchBody, /heading: scoutHeading/);
  assert.doesNotMatch(launchBody, /heading:\s*[A-Za-z.]*facing/);
});
check('战斗结算开始 ⇒ 侦察静默（销毁视觉/清空分队/取消事件）', () => {
  assert.match(sceneSource, /private beginBattleResolution\(\)/);
  assert.match(sceneSource, /if \(battleOver\) this\.beginBattleResolution\(\);/);
  assert.match(sceneSource, /battleResolutionStarted/);
});
check('开火双方都产生战斗接触并写档案（交战中不可消失的输入）', () => {
  assert.match(sceneSource, /markFleetIdentified\(defendingTeam, fleet\)/);
  assert.match(sceneSource, /markFleetIdentified\(shootingTeam, tgtFleet\)/);
  assert.match(sceneSource, /engaged: inExchange/);
  assert.match(sceneSource, /_revealedByFireToTeams/);
});
check('航迹失效唯一入口 breakFleetIdentification（置 _trackReliable=false）', () => {
  assert.match(sceneSource, /private breakFleetIdentification/);
  assert.match(sceneSource, /_trackReliable = false/);
  // 全场景只有唯一一处失效调用（import 不带括号不计）
  assert.equal(sceneSource.split('invalidateKnownTrack(').length - 1, 1, 'invalidateKnownTrack 只允许在唯一入口被调用一次');
});
check('W1 direct attack track 消费持久档案的可靠航迹状态', () => {
  assert.match(sceneSource, /reliable: this\.isTargetTrackReliable/);
  assert.match(commandSource, /\.reliable/);
});
check('watchdog objectiveProgress 已接通（占领进度 + 接近目标距离）', () => {
  assert.match(sceneSource, /st\.objectiveProgress \+= \(capPctW - st\.lastCapPct\) \/ 100/);
  assert.match(sceneSource, /st\.objectiveProgress \+= st\.lastObjDist - objDistW/);
  assert.match(sceneSource, /captureProgress/);
});
check('末次位置情报接触在渲染层落地（档案坐标，非实时位置）', () => {
  assert.match(sceneSource, /resolveIntelDisplay\(\{/);
  assert.match(sceneSource, /name: '末次位置'/);
  assert.match(overlaySource, /_intelDisplayMode/);
});
check('3D 呈现与 2D 同规则：敌方仅 live 档可见', () => {
  assert.match(overlaySource, /mode === 'live'/);
  assert.match(overlaySource, /isFleetIntelVisible/);
});
check('敌基地：未发现不渲染，确认后常驻（2D 决策门 + 3D 视觉门同档案）', () => {
  assert.match(sceneSource, /tryDiscoverEnemyBase/);
  assert.match(sceneSource, /isEnemyBaseKnownTo/);
  assert.match(sceneSource, /isTileKnownToFleet/);
  assert.match(overlaySource, /updateCastleIntelVisibility/);
  assert.match(overlaySource, /isEnemyBaseKnownTo/);
});
check('存档卫生接线：序列化 replacer + 读档剥离都已挂上', () => {
  assert.match(storeSource, /JSON\.stringify\(\{[\s\S]*?\}, battleTransientJsonReplacer\)/);
  assert.match(storeSource, /stripBattleTransientFields\(slot\.data\)/);
  assert.match(transientSource, /'directOrder'/);
  assert.match(transientSource, /'retreatState'/);
  assert.match(transientSource, /'_intelArchive'/);
  assert.match(transientSource, /'_trackReliable'/);
});

console.log(`\n${passed} recon/intel assertions passed`);
