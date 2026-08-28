<template>
  <!-- ===== 原有通讯面板（仅在游戏事件需要时显示，如开局教程）=====
       ✅ 修复：与抵达/战报/战后面板互斥，避免与它们同时占用 fixed overlay
       阻挡 Phaser canvas 鼠标事件 -->
  <Transition name="comms">
    <div v-if="visible && !showArrivalPanel && !showBattleResult && !showPostBattleOptions && !showCapturePanel" class="comms-overlay" @click.self="dismiss">
      <div class="comms-panel neo-card">
        <div class="comms-header" :class="headerClass">
          <span class="comms-title">{{ title }}</span>
          <button class="comms-close" @click="dismiss">✕</button>
        </div>
        <div class="comms-body">
          <div class="comms-portrait-wrap">
            <img :src="portraitUrl" class="comms-portrait" @error="onImgError" />
          </div>
          <div class="comms-content">
            <div class="comms-officer">{{ officerTitle }}</div>
            <div class="comms-message" v-html="formattedMessage"></div>
          </div>
        </div>
        <div class="comms-footer">
          <button class="neo-btn text-cyan" @click="dismiss">确认收到</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ===== 舰队到达决策面板 ===== -->
  <Transition name="arrival-slide">
    <div v-if="showArrivalPanel" class="comms-overlay" @keydown="onKeydown" tabindex="0" ref="arrivalPanelRef">
      <div class="comms-panel neo-card" role="dialog" :aria-label="arrivalTitle">
        <div class="comms-header" :class="arrivalFaction === 'alliance' ? 'header-alliance' : 'header-empire'">
          <span class="comms-title">{{ arrivalTitle }}</span>
        </div>
        <div class="comms-body">
          <div class="comms-content" style="flex:1">
            <div class="comms-officer">统合作战本部 · 舰队抵达报告</div>
            <div class="comms-message" v-html="arrivalMessage"></div>
          </div>
        </div>
        <div class="comms-footer" style="justify-content:flex-start;flex-wrap:wrap;gap:8px">
          <!-- 无防守：自动占领 + 取消 -->
          <template v-if="!arrivalHasEnemy">
            <button class="neo-btn text-green arrival-action-btn" @click="onArrivalAction('AUTO_OCCUPY')">
              <span class="btn-main">自动占领</span>
              <span class="btn-sub">消耗 1 日 · 损失约 {{ occLossPreview }} 舰</span>
            </button>
            <button class="neo-btn text-gray arrival-action-btn" @click="onArrivalAction('CANCEL')">
              <span class="btn-main">取消</span>
              <span class="btn-sub">驻留轨道待命</span>
            </button>
          </template>
          <!-- 有敌军：手动会战 + AI裁决 + 撤退 -->
          <template v-else>
            <button class="neo-btn text-gold arrival-action-btn" @click="onArrivalAction('MANUAL_BATTLE')">
              <span class="btn-main">手动会战</span>
              <span class="btn-sub">进入战术指挥界面</span>
            </button>
            <button class="neo-btn text-cyan arrival-action-btn" @click="onArrivalAction('AUTO_RESOLVE')">
              <span class="btn-main">AI 裁决</span>
              <span class="btn-sub">即时战力对比结算</span>
            </button>
            <button class="neo-btn text-red arrival-action-btn" @click="onArrivalAction('RETREAT')">
              <span class="btn-main">撤退</span>
              <span class="btn-sub">损失 3–8% 舰艇</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ===== 战后处置决策面板（占领/掠夺/解放）===== -->
  <Transition name="arrival-slide">
    <div v-if="showCapturePanel" class="comms-overlay">
      <div class="comms-panel neo-card">
        <div class="comms-header" :class="captureFaction === 'alliance' ? 'header-alliance' : 'header-empire'">
          <span class="comms-title">{{ captureTitle }}</span>
        </div>
        <div class="comms-body">
          <div class="comms-content" style="flex:1">
            <div class="comms-officer">统合作战本部 · 战后处置指令</div>
            <div class="comms-message" v-html="captureMessage"></div>
          </div>
        </div>
        <div class="comms-footer" style="justify-content:flex-start;flex-wrap:wrap;gap:8px">
          <button class="neo-btn text-green arrival-action-btn" @click="onCaptureAction('occupy')">
            <span class="btn-main">占领</span>
            <span class="btn-sub">纳入版图，恢复秩序</span>
          </button>
          <button class="neo-btn text-gold arrival-action-btn" @click="onCaptureAction('pillage')">
            <span class="btn-main">掠夺</span>
            <span class="btn-sub">获得资金 · 经济受损</span>
          </button>
          <button class="neo-btn text-cyan arrival-action-btn" @click="onCaptureAction('liberate')">
            <span class="btn-main">解放</span>
            <span class="btn-sub">回归中立 · +300 功勋</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ===== 战斗结果面板 ===== -->
  <Transition name="result-zoom">
    <div v-if="showBattleResult" class="comms-overlay" @keydown="onKeydown" tabindex="0" ref="resultPanelRef">
      <div class="comms-panel neo-card" role="dialog" :aria-label="battleResultTitle">
        <div class="comms-header" :class="postBattleFaction === 'alliance' ? 'header-alliance' : 'header-empire'">
          <span class="comms-title">{{ battleResultTitle }}</span>
        </div>
        <div class="comms-body" style="flex-direction:column;align-items:stretch">
          <!-- 战果大徽章 -->
          <div class="outcome-hero">
            <div class="outcome-badge-lg" :style="{ background: outcomeBadgeColor }">
              {{ outcomeBadgeText }}
            </div>
            <div class="outcome-summary">{{ battleResultSummary }}</div>
          </div>

          <!-- 舰船损失 3 列网格 -->
          <div class="loss-grid">
            <div class="loss-col loss-bb">
              <div class="loss-icon">⚔</div>
              <div class="loss-label">战列舰</div>
              <div class="loss-value" :class="attackerBbLoss > 0 ? 'text-red' : 'text-green'">
                {{ attackerBbLoss > 0 ? `-${attackerBbLoss}` : '无损' }}
              </div>
            </div>
            <div class="loss-col loss-ca">
              <div class="loss-icon">◈</div>
              <div class="loss-label">巡洋舰</div>
              <div class="loss-value" :class="attackerCaLoss > 0 ? 'text-red' : 'text-green'">
                {{ attackerCaLoss > 0 ? `-${attackerCaLoss}` : '无损' }}
              </div>
            </div>
            <div class="loss-col loss-dd">
              <div class="loss-icon">⚡</div>
              <div class="loss-label">驱逐舰</div>
              <div class="loss-value" :class="attackerDdLoss > 0 ? 'text-red' : 'text-green'">
                {{ attackerDdLoss > 0 ? `-${attackerDdLoss}` : '无损' }}
              </div>
            </div>
          </div>

          <!-- 剩余 + 功勋 -->
          <div class="result-meta">
            <div class="meta-item">
              <span class="meta-label">剩余舰艇</span>
              <span class="meta-val">{{ battleRemaining }} 艘</span>
            </div>
            <div class="meta-item">
              <span class="meta-label" :class="meritChange >= 0 ? 'text-gold' : 'text-red'">功勋变化</span>
              <span class="meta-val" :class="meritChange >= 0 ? 'text-gold' : 'text-red'">
                {{ meritChange >= 0 ? '+' : '' }}{{ meritChange }}
              </span>
            </div>
            <div class="meta-item" v-if="resultRatio">
              <span class="meta-label">战力比</span>
              <span class="meta-val text-cyan">{{ resultRatio }}:1</span>
            </div>
          </div>

          <!-- ROUT 提示 -->
          <div v-if="isRout" class="rout-warning">
            ⚠ 舰队溃散，需自动撤退至 {{ retreatNodeName || '上一据点' }}
          </div>
        </div>
        <div class="comms-footer">
          <button v-if="!isRout" class="neo-btn text-gold" @click="showPostBattleOptions = true; showBattleResult = false">
            确认战报
          </button>
          <button v-else class="neo-btn text-red" @click="onRoutRetreat">
            自动撤退至 {{ retreatNodeName || '上一据点' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ===== 战后行动面板 ===== -->
  <Transition name="arrival-slide">
    <div v-if="showPostBattleOptions" class="comms-overlay" @keydown="onKeydown" tabindex="0" ref="postBattlePanelRef">
      <div class="comms-panel neo-card" role="dialog" aria-label="战后行动">
        <div class="comms-header" :class="postBattleFaction === 'alliance' ? 'header-alliance' : 'header-empire'">
          <span class="comms-title">战后行动 — {{ postBattleNodeName }}</span>
        </div>
        <div class="comms-body">
          <div class="comms-content" style="flex:1">
            <div class="comms-officer">统合作战本部 · 行动指令部</div>
            <div class="comms-message">舰队已完成作战行动，请选择后续指令：</div>
          </div>
        </div>
        <div class="comms-footer" style="justify-content:flex-start;flex-wrap:wrap;gap:8px">
          <button class="neo-btn text-cyan arrival-action-btn" @click="onPostBattleAction('HOLD_POSITION')">
            <span class="btn-main">驻留此地</span>
            <span class="btn-sub">就地休整待命</span>
          </button>
          <button class="neo-btn text-gold arrival-action-btn" @click="onPostBattleAction('CONTINUE_ADVANCE')">
            <span class="btn-main">继续推进</span>
            <span class="btn-sub">右键选择新目标</span>
          </button>
          <button class="neo-btn text-red arrival-action-btn" @click="onPostBattleAction('RETURN_TO_BASE')">
            <span class="btn-main">返回基地补给</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useGameStore, getPortrait } from '../../store/gameStore';
import { ArrivalDecisionType, PostBattleActionType } from '../../types/game';
import { WAR_ECONOMY } from '../../config/economy';

const store = useGameStore();
// storeToRefs 保持 strategicPaused 的 ref 性质，便于通过 .value 安全赋值
// store 类型推断不到这些字段，强制 any 解构
const { strategicPaused } = storeToRefs(store as any) as any;

// ===== 辅助：安全获取 store 值 =====
function safeGet(name: string): any {
  const v = (store as any)[name];
  return v?.value !== undefined ? v.value : v;
}

// ===== 原有通讯面板逻辑 =====
const visible = computed(() => safeGet('commsMessage')?.visible ?? false);
const title = computed(() => safeGet('commsMessage')?.title ?? '');
const message = computed(() => safeGet('commsMessage')?.message ?? '');
const faction = computed(() => safeGet('commsMessage')?.faction ?? 'alliance');
const headerClass = computed(() => faction.value === 'alliance' ? 'header-alliance' : 'header-empire');
const officerTitle = computed(() => safeGet('commsMessage')?.officerTitle ?? (faction.value === 'alliance' ? '同盟统合作战本部 通讯官' : '帝国统帅本部 通讯官'));
const portraitUrl = computed(() => {
  const id = safeGet('commsMessage')?.portraitId ?? (faction.value === 'alliance' ? 9165 : 9099);
  return getPortrait(id);
});
const fallbackPortrait = ref(false);
const onImgError = () => { fallbackPortrait.value = true; };
const formattedMessage = computed(() => message.value.replace(/\n/g, '<br>'));
const dismiss = () => {
  // ✅ 修复：Pinia store 自动解包 refs，store.commsMessage 已是 plain object；
  // 这里兼容两种写法（ref 形式 / Pinia 解包后的 plain object），
  // 避免双重赋值逻辑混乱
  const anyStore = store as any;
  const msg = anyStore.commsMessage;
  if (msg && typeof msg === 'object' && 'value' in msg && msg.value !== undefined) {
    // ref 形式（理论上不会到达此处，但保留兼容）
    msg.value = { visible: false, title: '', message: '', faction: 'alliance' };
  } else {
    // Pinia 解包后的 plain object：直接整体替换
    anyStore.commsMessage = { visible: false, title: '', message: '', faction: 'alliance' };
  }
};

// ===== 舰队到达决策面板 =====
const showArrivalPanel = ref(false);
const arrivalTitle = ref('');
const arrivalMessage = ref('');
const arrivalFaction = ref('alliance');
const arrivalHasEnemy = ref(false);
const arrivalFleetId = ref(0);
const occLossPreview = ref(0);

watch(() => safeGet('pendingArrival'), (newVal: any) => {
  if (!newVal) { showArrivalPanel.value = false; return; }
  const allAdms = safeGet('allAdmirals') || [];
  const allFleets = safeGet('strategicFleets') || [];
  const fleet = allFleets.find((f: any) => f.id === newVal.fleetId);
  const adm = fleet ? allAdms.find((a: any) => a.id === fleet.commanderId) : null;
  const fac = fleet?.factionId === 1 ? 'alliance' : 'empire';
  const rawNodes = safeGet('strategicNodes') || [];
  const node = rawNodes.find((n: any) => n.id === newVal.targetNodeId);

  const comp = fleet?.composition || {};
  const total = (comp.battleships || 0) + (comp.fastBattleships || 0) + (comp.cruisers || 0) + (comp.destroyers || 0) + (comp.carriers || 0) + (comp.fighters || 0);
  occLossPreview.value = Math.ceil(total * 0.08);

  arrivalFaction.value = fac;
  arrivalTitle.value = `舰队抵达 — ${node?.name || '目标星域'}`;
  arrivalHasEnemy.value = newVal.hasEnemyFleet;
  arrivalFleetId.value = newVal.fleetId;

  let msg = `${adm?.name || '舰队'} 已抵达 ${node?.name || '目标星域'}。`;
  msg += `<br><br>【抵达环境】`;
  msg += `<br>  • 战力: ${total} 舰`;
  msg += `<br>  • 星球驻防: ${newVal.isPlanetOccupied ? '有' : '无'}`;
  if (newVal.hasEnemyFleet)
    msg += `<br>  • 敌方: ${newVal.enemyCommanderName || '未知'} 舰队 · ${newVal.enemyShipCount} 舰`;
  else
    msg += `<br>  • 敌方: 未检测到舰队`;
  arrivalMessage.value = msg;
  showArrivalPanel.value = true;
}, { immediate: true });

function onArrivalAction(type: string) {
  const actionMap: Record<string, ArrivalDecisionType> = {
    'AUTO_OCCUPY': ArrivalDecisionType.AUTO_OCCUPY,
    'CANCEL': ArrivalDecisionType.CANCEL,
    'MANUAL_BATTLE': ArrivalDecisionType.MANUAL_BATTLE,
    'AUTO_RESOLVE': ArrivalDecisionType.AUTO_RESOLVE,
    'RETREAT': ArrivalDecisionType.RETREAT,
  };
  const dt = actionMap[type];
  if (dt !== undefined) (store as any).handleArrivalDecision(dt);
  showArrivalPanel.value = false;
}

// ===== 战后处置决策面板（占领/掠夺/解放）=====
const showCapturePanel = ref(false);
const captureTitle = ref('');
const captureMessage = ref('');
const captureFaction = ref('alliance');

watch(() => safeGet('pendingCaptureDecision'), (newVal: any) => {
  if (!newVal) { showCapturePanel.value = false; return; }
  const rawNodes = safeGet('strategicNodes') || [];
  const node = rawNodes.find((n: any) => n.id === newVal.nodeId);
  const pFactionId = (store as any).allAdmirals?.find((a: any) => a.id === (store as any).playerAdmiralId)?.faction;
  captureFaction.value = pFactionId === 'alliance' ? 'alliance' : 'empire';
  captureTitle.value = `战后处置 — ${node?.name || '目标星域'}`;
  const economy = node?.economy || 30;
  // 修复：掠夺预估与实际到账（gameStore.handleCapturePillage）统一，均用 WAR_ECONOMY 系数，
  //       消除旧代码 economy*15 与 economy*1500 的 100 倍不一致。
  const pillGold = economy * WAR_ECONOMY.pillageMul + (node?.defenseHp || 50) * WAR_ECONOMY.pillageHpMul;
  captureMessage.value = `目标星域已被攻克。请选择处置方式：<br><br>`
    + `<b>占领</b> — 纳入版图，恢复秩序（常规收益）<br>`
    + `<b>掠夺</b> — 获得约 ${pillGold.toFixed(0)} 资金，经济/防御永久减半<br>`
    + `<b>解放</b> — 回归中立，获得 300 战术功勋`;
  showCapturePanel.value = true;
}, { immediate: true });

function onCaptureAction(type: string) {
  if (type === 'occupy') (store as any).handleCaptureOccupy();
  else if (type === 'pillage') (store as any).handleCapturePillage();
  else if (type === 'liberate') (store as any).handleCaptureLiberate();
  showCapturePanel.value = false;
}

// ===== 战斗结果面板 =====
const showBattleResult = ref(false);
const battleResultTitle = ref('');
const battleResultSummary = ref('');
const postBattleFaction = ref('alliance');
const outcomeBadgeText = ref('');
const outcomeBadgeColor = ref('var(--color-text-secondary)');
const isRout = ref(false);
const postBattleNodeName = ref('');
const battleResultFleetId = ref(0);
const retreatNodeName = ref('');
const attackerBbLoss = ref(0);
const attackerCaLoss = ref(0);
const attackerDdLoss = ref(0);
const battleRemaining = ref(0);
const meritChange = ref(0);
const resultRatio = ref(0);

const outcomeConfig: Record<string, [string, string]> = {
  decisive_win: ['大胜', 'var(--color-green)'],
  marginal_win: ['险胜', 'var(--color-warning)'],
  stalemate: ['胶着', 'var(--color-text-secondary)'],
  rout: ['溃败', 'var(--color-empire)'],
};

const meritConfig: Record<string, number> = {
  decisive_win: 500,
  marginal_win: 200,
  stalemate: 50,
  rout: -100,
};

watch(() => safeGet('pendingPostBattle'), (newVal: any) => {
  if (!newVal) { showBattleResult.value = false; return; }

  const allAdms = safeGet('allAdmirals') || [];
  const allFleets = safeGet('strategicFleets') || [];
  const fleet = allFleets.find((f: any) => f.id === newVal.fleetId);
  const adm = fleet ? allAdms.find((a: any) => a.id === fleet.commanderId) : null;
  const fac = fleet?.factionId === 1 ? 'alliance' : 'empire';
  const rawNodes = safeGet('strategicNodes') || [];
  const node = rawNodes.find((n: any) => n.id === newVal.nodeId);
  const result = newVal.result;

  postBattleFaction.value = fac;
  postBattleNodeName.value = node?.name || '目标星域';
  battleResultFleetId.value = newVal.fleetId;

  if (!result) { showBattleResult.value = false; return; }

  const [label, color] = outcomeConfig[result.outcome] || ['未知', 'var(--color-text-secondary)'];
  outcomeBadgeText.value = label;
  outcomeBadgeColor.value = color;
  isRout.value = result.outcome === 'rout';
  battleResultTitle.value = `战斗报告 — ${node?.name || '目标星域'}`;
  battleResultSummary.value = result.summary || '';
  meritChange.value = meritConfig[result.outcome] || 0;
  resultRatio.value = result.ratio || 0;
  battleRemaining.value = result.attackerRemaining || 0;

  // 按舰种估算损失
  const comp = fleet?.composition;
  const bbBefore = comp ? comp.battleships + (result.outcome === 'rout' ? result.attackerLosses * 0.4 : result.attackerLosses * 0.4) : 0;
  const caBefore = comp ? comp.cruisers + (result.attackerLosses * 0.35) : 0;
  const ddBefore = comp ? comp.destroyers + (result.attackerLosses * 0.25) : 0;
  const totalLoss = result.attackerLosses || 0;
  attackerBbLoss.value = Math.round(totalLoss * 0.4);
  attackerCaLoss.value = Math.round(totalLoss * 0.35);
  attackerDdLoss.value = Math.round(totalLoss * 0.25);

  // 撤退节点名
  if (result.outcome === 'rout') {
    const prevNodeId = fleet?.prevNodeId;
    const prevNode = rawNodes.find((n: any) => n.id === prevNodeId);
    retreatNodeName.value = prevNode?.name || '上一据点';
  }

  showBattleResult.value = true;
  showPostBattleOptions.value = false;
}, { immediate: true });

function onRoutRetreat() {
  const ppb = (store as any).pendingPostBattle;
  (store as any).retreatFleet(battleResultFleetId.value);
  if (ppb?.value !== undefined) ppb.value = null; else (store as any).pendingPostBattle = null;
  // 通过 storeToRefs 拿到的 ref 直接 .value 赋值，Pinia 自动同步
  strategicPaused.value = false;
  showBattleResult.value = false;
}

// ===== 战后行动面板 =====
const showPostBattleOptions = ref(false);

function onPostBattleAction(type: string) {
  const actionMap: Record<string, PostBattleActionType> = {
    'HOLD_POSITION': PostBattleActionType.HOLD_POSITION,
    'CONTINUE_ADVANCE': PostBattleActionType.CONTINUE_ADVANCE,
    'RETURN_TO_BASE': PostBattleActionType.RETURN_TO_BASE,
  };
  (store as any).handlePostBattle(actionMap[type]);
  showPostBattleOptions.value = false;
}

// ===== 键盘导航 =====
const arrivalPanelRef = ref<HTMLElement | null>(null);
const resultPanelRef = ref<HTMLElement | null>(null);
const postBattlePanelRef = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // Esc = 关闭当前面板
    if (showArrivalPanel.value) showArrivalPanel.value = false;
    else if (showBattleResult.value) showBattleResult.value = false;
    else if (showPostBattleOptions.value) showPostBattleOptions.value = false;
  } else if (e.key === 'Enter') {
    // Enter = 第一个按钮的默认动作
    const panel = showArrivalPanel.value ? arrivalPanelRef.value
      : showBattleResult.value ? resultPanelRef.value
      : showPostBattleOptions.value ? postBattlePanelRef.value : null;
    if (panel) {
      const firstBtn = panel.querySelector('.comms-footer button') as HTMLElement;
      firstBtn?.click();
    }
  }
  // Tab 自然切换焦点
}

// 面板打开时自动聚焦
watch([showArrivalPanel, showBattleResult, showPostBattleOptions], async () => {
  await nextTick();
  if (showArrivalPanel.value) arrivalPanelRef.value?.focus();
  else if (showBattleResult.value) resultPanelRef.value?.focus();
  else if (showPostBattleOptions.value) postBattlePanelRef.value?.focus();
});
</script>

<style scoped>
/* ===== 基础 ===== */
.comms-overlay {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
  display: flex; justify-content: center; align-items: flex-end;
  padding-bottom: 20px; pointer-events: none;
}
.comms-panel {
  width: 580px;
  /* ✅ 修复：限制最大宽度 100vw - 80px（左右各留 40px 边距），
     避免面板过宽覆盖整个 Phaser canvas 区域，阻断地图鼠标交互 */
  max-width: calc(100vw - 80px);
  /* ✅ 修复：限制最大高度不超过屏幕高度 - 80px（上下各留 40px 边距），
     防止面板过高覆盖整个地图视口 */
  max-height: calc(100vh - 80px);
  overflow: auto;
  background: var(--overlay-surface);
  border: 1px solid var(--neo-surface-raised);
  border-radius: 8px 8px 0 0;
  pointer-events: auto;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.5);
}
.comms-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; font-size: 13px; font-weight: 800;
}
.header-alliance { background: linear-gradient(90deg, var(--color-alliance-dim), var(--neo-surface)); color: var(--color-alliance); }
.header-empire { background: linear-gradient(90deg, var(--color-empire-dim), var(--neo-surface)); color: var(--color-empire); }
.comms-close { background: none; border: none; color: var(--color-text-disabled); font-size: 16px; cursor: pointer; }
.comms-close:hover { color: var(--color-text-primary); }
.comms-body {
  display: flex; padding: 16px; gap: 14px; align-items: flex-start; min-height: 80px;
}
.comms-portrait-wrap {
  flex-shrink: 0; width: 64px; height: 80px;
  border: 1px solid var(--overlay-border); border-radius: 4px;
  overflow: hidden; background: var(--neo-surface-raised);
}
.comms-portrait { width: 100%; height: 100%; object-fit: cover; }
.comms-content { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.comms-officer { font-size: 11px; color: var(--color-text-secondary); font-weight: 600; }
.comms-message { font-size: 13px; color: var(--color-text-secondary); line-height: 1.6; white-space: pre-line; }
.comms-footer {
  padding: 10px 16px; border-top: 1px solid var(--neo-surface-raised);
  display: flex; justify-content: flex-end;
}

/* ===== 到达按钮 ===== */
.arrival-action-btn {
  display: flex; flex-direction: column; align-items: flex-start;
  padding: 8px 14px; min-width: 140px; gap: 2px;
  transition: all 0.2s; cursor: pointer;
}
.arrival-action-btn:hover { transform: translateY(-2px); filter: brightness(1.2); }
.arrival-action-btn:active { transform: translateY(0); }
.btn-main { font-size: 13px; font-weight: 800; }
.btn-sub { font-size: 10px; opacity: 0.8; }

/* ===== 战斗结果徽章 ===== */
.outcome-hero {
  display: flex; align-items: center; gap: 14px; padding: 4px 0 10px;
}
.outcome-badge-lg {
  padding: 8px 20px; border-radius: 6px;
  font-size: 18px; font-weight: 900; color: var(--color-text-primary);
  letter-spacing: 0.08em; flex-shrink: 0;
}
.outcome-summary { font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; }

/* 舰船损失 3 列网格 */
.loss-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;
  margin-bottom: 10px;
}
.loss-col {
  padding: 6px 8px; border-radius: 4px;
  text-align: center; background: rgba(30,41,59,0.6);
}
.loss-bb { border-top: 2px solid var(--color-warning); }
.loss-ca { border-top: 2px solid var(--color-cyan); }
.loss-dd { border-top: 2px solid var(--color-green); }
.loss-icon { font-size: 16px; margin-bottom: 2px; }
.loss-label { font-size: 10px; color: var(--color-text-secondary); font-weight: 700; }
.loss-value { font-size: 14px; font-weight: 900; }
.text-red { color: var(--color-empire); }
.text-green { color: var(--color-green); }
.text-gold { color: var(--color-warning); }

/* 剩余+功勋 */
.result-meta {
  display: flex; gap: 16px; flex-wrap: wrap;
}
.meta-item { display: flex; flex-direction: column; gap: 2px; }
.meta-label { font-size: 10px; color: var(--color-text-disabled); font-weight: 700; }
.meta-val { font-size: 14px; font-weight: 900; color: var(--color-text-primary); }
.text-cyan { color: var(--color-cyan); }

/* ROUT 警告 */
.rout-warning {
  margin-top: 10px; padding: 8px 10px;
  background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3);
  border-radius: 4px; font-size: 12px; color: var(--color-empire);
}

/* ===== 按钮颜色 ===== */
.text-green { background: var(--color-green-muted); color: var(--color-green); border: 1px solid var(--color-green); }
.text-green:hover { background: var(--color-green); }
.text-gold { background: var(--color-warning-muted); color: var(--color-warning); border: 1px solid var(--color-warning); }
.text-gold:hover { background: var(--color-warning); }
.text-gray { background: var(--color-border); color: var(--color-text-secondary); border: 1px solid var(--color-border-emphasized); }
.text-gray:hover { background: var(--color-border-emphasized); }
.text-red { background: var(--color-error-muted); color: var(--color-empire); border: 1px solid var(--color-empire); }
.text-red:hover { background: var(--color-empire); }
.text-cyan { background: var(--color-cyan-muted); color: var(--color-cyan); border: 1px solid var(--color-cyan); }
.text-cyan:hover { background: var(--color-cyan); }

/* ===== 过渡动画 ===== */
.comms-enter-active { transition: all 0.35s ease-out; }
.comms-leave-active { transition: all 0.25s ease-in; }
.comms-enter-from { transform: translateY(100%); opacity: 0; }
.comms-leave-to { transform: translateY(100%); opacity: 0; }

.arrival-slide-enter-active { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.arrival-slide-leave-active { transition: all 0.25s ease-in; }
.arrival-slide-enter-from { transform: translateY(80px); opacity: 0; filter: blur(4px); }
.arrival-slide-leave-to { transform: translateY(40px); opacity: 0; }

.result-zoom-enter-active { transition: all 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
.result-zoom-leave-active { transition: all 0.2s ease-in; }
.result-zoom-enter-from { transform: scale(0.9) translateY(20px); opacity: 0; }
.result-zoom-leave-to { transform: scale(0.95); opacity: 0; }
</style>
