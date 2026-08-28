<template>
  <div id="game-container" v-if="isDataLoaded">
    <TitleScreen v-if="gameState === 'title'" />
    <MainMenu v-if="gameState === 'menu'" />
    <SimScreen v-if="gameState === 'sim'" />

    <div v-if="gameState === 'game'" class="game-screen" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999;">
      <GameHeader />
      <div id="phaser-canvas-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></div>

      <div v-if="showCRTBorder" class="crt-monitor-border">
        <span class="crt-corner tr"></span>
        <span class="crt-corner bl"></span>
      </div>

      <div class="fleet-ui-layer">
        <div v-for="fleet in fleetsUI" :key="fleet.id"
            class="fleet-float-ui"
            :style="{ left: fleet.x + 'px', top: (fleet.y - 45) + 'px' }">
          <img :src="getPortrait(fleet.imageId)" class="fleet-portrait" @error="handleImgError" />
          <div class="fleet-info">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div class="fleet-name" :class="fleet.team === 1 ? 'text-cyan' : 'text-red'">{{ fleet.name }}</div>
                <div style="font-size: 9px; color: var(--color-text-secondary); font-weight: 800;">{{ fleet.unitCount }} 艘</div>
            </div>
            <div class="fleet-hp-bar">
              <div class="hp-fill" :class="fleet.team === 1 ? 'bg-cyan' : 'bg-red'" :style="{ width: Math.max(0, (fleet.hp / fleet.maxHp) * 100) + '%' }"></div>
            </div>
            <!-- 补给条 -->
            <div class="fleet-hp-bar" style="height: 2px; margin-top: 2px; background: var(--neo-surface-raised);">
              <div class="hp-fill" :style="{ width: fleet.supply + '%', background: fleet.supply > 30 ? 'var(--color-green)' : 'var(--color-warning)' }"></div>
            </div>

            <!-- 战术姿态面板 -->
            <div class="stance-controls" v-if="fleet.team === 1">
              <button class="stance-btn" :class="{active: fleet.stance === 'search'}" @click="store.dispatchFleetCommand(fleet.id, 'stance', 'search')">索敌</button>
              <button class="stance-btn" :class="{active: fleet.stance === 'siege'}" @click="store.dispatchFleetCommand(fleet.id, 'stance', 'siege')">攻坚</button>
              <button class="stance-btn" :class="{active: fleet.stance === 'defend'}" @click="store.dispatchFleetCommand(fleet.id, 'stance', 'defend')">驻守</button>
            </div>
          </div>
        </div>
      </div>

      <GameFooter />
      <SettlementModal v-if="gameOver" />
    </div>

    <EditorScreen v-if="gameState === 'editor'" />
    <StrategicScreen v-if="gameState === 'strategy'" @open-save="showSaveModal = true" />

    <!-- v3 新增：全局二次确认弹窗 -->
    <ConfirmDialog />

    <!-- 战后处置弹窗 -->
    <PostBattlePanel v-if="hasCaptureDecision && gameState === 'strategy'" @resolve="handleCaptureResolve" />

    <!-- 全局存档弹窗 -->
    <SaveManagerModal v-if="showSaveModal" @close="showSaveModal = false" />

    <!-- 提督选择弹窗 (新游戏) -->
    <AdmiralSelectModal v-if="showAdmiralSelect" @confirm="handleAdmiralSelect" @cancel="handleAdmiralCancel" />
    <OpeningBriefing v-if="showBriefing" @close="showBriefing = false" />
    <CommsPanel />

    <!-- 指挥面板（游戏暂停时显示） -->
    <CommandPanel
      v-if="showCommandPanel && commandBridge.cpState"
      :cp-state="commandBridge.cpState"
      :fleet-admiral-id="commandBridge.fleetAdmiralId"
      :battle-admiral-ids="commandBridge.battleAdmiralIds"
      @close="handleCommandClose"
      @select-target="handleCommandSelectTarget"
    />

    <!-- 战斗日志 -->
    <BattleLogPanel ref="battleLogRef" />

    <!-- 强行通过提案 -->
    <ForcePassDialog
      v-if="store.showForcePass"
      :proposal-title="(store.forcePassProposal as any)?.title || '未知提案'"
      :player-p-p="(store.allAdmirals as any)?.find?.((a: any) => a.id === store.playerAdmiralId)?.politicalWork || 0"
      @force="store.handleForcePass"
      @decline="store.handleForcePassDecline"
    />

    <!-- 全局 Toast 通知 -->
    <Transition name="toast-fade">
      <div v-if="toastMessage" class="global-toast" :key="toastKey">{{ toastMessage }}</div>
    </Transition>
  </div>
  
  <div v-else class="loading-screen" style="display: flex; justify-content: center; align-items: center; height: 100vh; color: var(--color-cyan); font-size: 14px; font-weight: 800;">
    接入战术网络中...
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useGameStore, getPortrait } from './store/gameStore';
import { mountGame, unmountGame } from './game/GameInstance';

import GameHeader from './components/battle/GameHeader.vue';
import GameFooter from './components/battle/GameFooter.vue';
import SettlementModal from './components/battle/SettlementModal.vue';
import MainMenu from './components/meta/MainMenu.vue';
import EditorScreen from './components/EditorScreen.vue';
import StrategicScreen from './components/meta/StrategicScreen.vue';
import SimScreen from './components/meta/SimScreen.vue';
import TitleScreen from './components/meta/TitleScreen.vue';
import SaveManagerModal from './components/meta/SaveManagerModal.vue';
import AdmiralSelectModal from './components/meta/AdmiralSelectModal.vue';
import PostBattlePanel from './components/meta/PostBattlePanel.vue';
import CommsPanel from './components/meta/CommsPanel.vue';
import ConfirmDialog from './components/meta/ConfirmDialog.vue';
import OpeningBriefing from './components/meta/OpeningBriefing.vue';
import { useSettingsStore } from './store/settingsStore';
import CommandPanel from './components/battle/CommandPanel.vue';
import BattleLogPanel from './components/battle/BattleLogPanel.vue';
import ForcePassDialog from './components/meta/ForcePassDialog.vue';
import { commandBridge } from './services/CommandBridge';
import { initMusic, unlockAudio, setEnabled, setVolume } from './services/MusicManager';

const store = useGameStore();
const settings = useSettingsStore();
const showSaveModal = ref(false);
const showBriefing = ref(false);
const battleLogRef = ref<InstanceType<typeof BattleLogPanel> | null>(null);

// 指挥面板状态（由 BattleScene 通过 commandBridge 控制）
const showCommandPanel = computed(() => commandBridge.visible);

function handleCommandClose() {
  if (commandBridge.pendingCallback) {
    commandBridge.pendingCallback(null);
  }
  commandBridge.visible = false;
}

function handleCommandSelectTarget(abilityId: string) {
  commandBridge.selectedAbilityId = abilityId;
  // 目标选择由 BattleScene 的 pointer 事件处理
}

// 提督选择弹窗状态
const showAdmiralSelect = computed(() => {
  const r = (store as any).showAdmiralSelect;
  return r?.value !== undefined ? r.value : r;
});

const handleAdmiralSelect = (admiralId: number) => {
  if (typeof (store as any).confirmAdmiralSelect === 'function') {
    (store as any).confirmAdmiralSelect(admiralId);
  }
  // 开局简报
  const briefingDisabled = (settings as any).briefingDisabled;
  if (!briefingDisabled) {
    showBriefing.value = true;
  }
};

const handleAdmiralCancel = () => {
  // 不选择则保持默认，可以稍后再次触发
  // 暂时关闭弹窗
  (store as any).showAdmiralSelect = false;
};

const hasCaptureDecision = computed(() => !!(store as any).pendingCaptureDecision);
const handleCaptureResolve = (action: string) => {
  const s = store as any;
  if (action === 'occupy') s.handleCaptureOccupy?.();
  else if (action === 'pillage') s.handleCapturePillage?.();
  else if (action === 'liberate') s.handleCaptureLiberate?.();
};

const gameState = computed<'title' | 'menu' | 'editor' | 'game' | 'strategy' | 'sim'>(() => (store.gameState as any).value ?? store.gameState);
const isDataLoaded = computed<boolean>(() => (store.isDataLoaded as any).value ?? store.isDataLoaded);
const gameOver = computed<boolean>(() => (store.gameOver as any).value ?? store.gameOver);
const showCRTBorder = computed<boolean>(() => {
  const ts = (store.tacticalState as any)?.value ?? (store.tacticalState as any);
  return gameState.value === 'game' && ts?.mapStyle === 'crt';
});

// 全局 Toast：Pinia 自动解包后直接读
const toastMessage = computed<string>(() => {
  const r = (store as any).toastMessage;
  if (typeof r === 'string') return r;
  if (r?.value !== undefined) return r.value;
  return '';
});
const toastKey = computed(() => toastMessage.value); // 变化时触发 Transition 重新播放

const fleetsUI = computed<any[]>(() => {
  const raw = (store as any).fleetsUI;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40"><rect width="32" height="40" fill="%231e293b"/></svg>';
};

const handleKeyDown = (e: KeyboardEvent) => {
  const currentGameState = (store.gameState as any).value ?? store.gameState;
  if (currentGameState !== 'game') return;

  // Space 键已由 BattleScene 的指挥点系统接管，此处不再处理
  if (e.code === 'KeyT') { 
    if ((store.isCastingBomb as any).value !== undefined) {
      (store.isCastingBomb as any).value = !(store.isCastingBomb as any).value;
    } else {
      (store as any).isCastingBomb = !store.isCastingBomb;
    }
  }
  else if (e.code === 'Escape') {
    store.returnToMetaMenu();
  }
  else if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
    const idx = parseInt(e.key) - 1;
    const gears = (store.speedGears as any).value ?? store.speedGears;
    if (gears && gears[idx] !== undefined) {
        if ((store.currentSpeedFactor as any).value !== undefined) {
            (store.currentSpeedFactor as any).value = gears[idx];
        } else {
            (store as any).currentSpeedFactor = gears[idx];
        }
    }
  }
};

onMounted(async () => {
  await store.initLoadData();
  window.addEventListener('keydown', handleKeyDown);

  // 音乐：先构建随机队列但不播放（等用户交互解锁 autoplay 限制）
  initMusic();
  setEnabled((settings as any).musicEnabled);
  setVolume((settings as any).musicVolume);

  // 首次交互时解锁音频播放
  const unlockAudioFn = () => {
    unlockAudio();
    document.removeEventListener('click', unlockAudioFn);
    document.removeEventListener('keydown', unlockAudioFn);
  };
  document.addEventListener('click', unlockAudioFn);
  document.addEventListener('keydown', unlockAudioFn);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// 监听设置变化 → 同步到音乐播放器
watch(() => (settings as any).musicEnabled, (v: boolean) => setEnabled(v));
watch(() => (settings as any).musicVolume,  (v: number) => setVolume(v));

// UI 缩放因子：统一放大全局字体/按钮/菜单，解决"整体文字太小"问题
// 用 html 根级 CSS zoom：px 与 rem 控件同步放大、指针坐标比值不变（raycast/OrbitControls 不受影响）
const applyUiScale = (n: number) => {
  const root = document.documentElement;
  const factor = Math.max(0.8, Math.min(1.4, n / 100));
  (root.style as any).zoom = factor.toFixed(3);
  root.style.setProperty('--ui-scale', factor.toFixed(3));
};
// 初始化 + 监听变化
applyUiScale((settings as any).uiScale ?? 100);
watch(() => (settings as any).uiScale, (v: number) => applyUiScale(v));

watch(gameState, (newState, oldState) => {
    console.log(`[App.vue] gameState change: ${oldState} -> ${newState}`);
    if (newState === 'game') {
        // 使用 setTimeout(0) 强制让出主线程，等 v-if 完成 DOM 插入
        // 然后再调用 mountGame
        const tryMount = (attempt: number) => {
            const container = document.getElementById('phaser-canvas-container');
            if (container && container.clientWidth > 0 && container.clientHeight > 0) {
                console.log(`[App.vue] Mounting Phaser to #phaser-canvas-container (${container.clientWidth}x${container.clientHeight}) [attempt ${attempt}]`);
                mountGame('phaser-canvas-container');
            } else if (attempt < 10) {
                console.log(`[App.vue] Container not ready, retry ${attempt}...`);
                setTimeout(() => tryMount(attempt + 1), 50);
            } else {
                console.error('[App.vue] Failed to mount Phaser after 10 attempts. Container:', container);
            }
        };
        setTimeout(() => tryMount(1), 100);
    } else {
        unmountGame();
    }
});
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');

.crt-monitor-border {
  position: fixed;
  top: 10px; left: 10px; right: 10px; bottom: 10px;
  border: 1.5px solid rgba(0, 204, 102, 0.35);
  pointer-events: none;
  z-index: 1001;
}
.crt-monitor-border::before,
.crt-monitor-border::after {
  content: '';
  position: absolute;
  width: 22px; height: 22px;
  border-color: rgba(0, 204, 102, 0.6);
  border-style: solid;
  border-width: 0;
}
.crt-monitor-border::before {
  top: -1px; left: -1px;
  border-top-width: 2.5px; border-left-width: 2.5px;
}
.crt-monitor-border::after {
  bottom: -1px; right: -1px;
  border-bottom-width: 2.5px; border-right-width: 2.5px;
}
.crt-corner { position: absolute; width: 22px; height: 22px; border: 0 solid rgba(0,204,102,0.6); }
.crt-corner.tr { top: -1px; right: -1px; border-top-width: 2.5px; border-right-width: 2.5px; }
.crt-corner.bl { bottom: -1px; left: -1px; border-bottom-width: 2.5px; border-left-width: 2.5px; }

*, *::before, *::after { box-sizing: border-box; font-family: 'Inter', sans-serif; }

html, body { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; }

#game-container { 
  display: block; width: 100%; height: 100vh; margin: 0; padding: 0; overflow: hidden; 
  background: var(--color-background-body); color: var(--color-text-primary); 
  font-family: var(--font-family);
}

/* neo-* 样式由 theme/tokens.css 统一定义 */

.icon-btn { padding: 8px 12px; font-weight: 800; font-size: 13px; flex-shrink: 0; }

/* Toast 动画 */
.toast-enter-active { animation: toastIn 0.3s var(--ease-out); }
.toast-leave-active { animation: toastOut 0.2s var(--ease-out); }
@keyframes toastIn  { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes toastOut { to { opacity: 0; transform: translate(-50%, -20px); } }

/* 通用动画 */
.animate-fade { animation: fadeIn 0.3s var(--ease-out); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* Toast 动画 */
.toast-fade-enter-active { animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.toast-fade-leave-active { transition: all 0.3s ease; }
.toast-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(-20px); }

.menu-screen { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.menu-sidebar { 
  width: 200px; padding: 30px 15px; display: flex; flex-direction: column; gap: 24px; position: fixed;
  height: 100vh; left: 0; top: 0; z-index: 100; background: var(--neo-body); border-right: 2px solid var(--neo-surface);
  transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1); 
}
.menu-sidebar.is-collapsed { width: 80px; padding: 30px 10px; }
.menu-sidebar-spacer { width: 200px; flex-shrink: 0; transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.menu-sidebar-spacer.is-collapsed { width: 80px; }

.sidebar-header { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 10px; }
.logo-box { display: flex; align-items: center; gap: 8px; }
.game-logo { font-size: 16px; font-weight: 800; color: var(--color-text-primary); white-space: nowrap; }
.version-tag { font-size: 10px; background: rgba(0,0,0,0.3); padding: 3px 6px; border-radius: 99px; margin-left: 6px; color: var(--color-text-secondary); }

.btn-toggle-sidebar { background: transparent; border: none; color: var(--color-text-secondary); cursor: pointer; transition: color 0.2s; font-family: monospace; }
.btn-toggle-sidebar:hover { color: var(--color-text-primary); }

.menu-nav { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }
.btn-nav-item { padding: 12px; display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }

.menu-main-content { 
  flex: 1; height: 100vh; overflow-y: hidden; padding: 20px; display: flex; justify-content: center;
}
.content-wrapper { max-width: 800px; width: 100%; display: flex; flex-direction: column; gap: 20px; }

.global-resource-bar { 
  display: flex; justify-content: space-between; align-items: center; 
  padding: 16px 24px; flex-shrink: 0; margin-bottom: 5px;
}
.res-group { display: flex; gap: 20px; }
.res-item { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.btn-fortune { padding: 8px 20px; font-weight: 800; font-size: 13px; color: var(--color-cyan); }

.tab-panel { flex: 1; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; padding: 5px; }

.battle-setup-container { justify-content: flex-start; }
.setup-controls-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.control-group { display: flex; flex-direction: column; gap: 10px; }
.control-group label { font-size: 14px; font-weight: 800; color: var(--color-text-primary); padding-left: 6px; border-left: 4px solid var(--color-cyan); line-height: 1; }
.map-select-group { display: flex; gap: 10px; align-items: stretch; }

.select-wrapper { position: relative; display: flex; align-items: center; padding: 0; }
.select-wrapper::after { content: '▼'; position: absolute; right: 15px; color: var(--color-cyan); pointer-events: none; font-size: 12px; }
.neo-select { 
  width: 100%; appearance: none; background: transparent; border: none; 
  color: var(--color-text-primary); padding: 14px 16px; font-size: 14px; font-weight: 800; outline: none; cursor: pointer;
}
.neo-select option { background: var(--neo-surface); color: var(--color-text-secondary); }

.preview-board { 
  flex: none; display: flex; flex-direction: column; padding: 24px; gap: 20px; justify-content: flex-start;
}
.preview-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--overlay-hover); padding-bottom: 12px; }
.preview-header h3 { font-size: 20px; font-weight: 900; margin: 0; }
.vs-badge { background: var(--color-empire); color: var(--color-text-primary); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 800; }
.preview-details { display: flex; flex-direction: column; gap: 12px; }
.detail-item { display: flex; gap: 15px; align-items: flex-start; }
.detail-item .label { color: var(--color-text-disabled); font-size: 13px; font-weight: 800; white-space: nowrap; width: 65px; }
.detail-item .value { color: var(--color-text-primary); font-size: 14px; font-weight: 600; line-height: 1.5; }

.start-action-zone { display: flex; justify-content: center; margin-top: auto; flex-shrink: 0; padding-top: 10px; }
.btn-launch-game { padding: 16px; font-size: 16px; width: 100%; }

.deck-builder-panel { display: flex; flex-direction: column; overflow: hidden; }
.deck-top-section { display: flex; gap: 20px; flex-shrink: 0; }
.deck-slots-container, .synergy-container { flex: 1; padding: 15px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.deck-header-row { display: flex; justify-content: space-between; align-items: center; }
.panel-title-small { font-size: 13px; font-weight: 800; color: var(--color-text-primary); padding-left: 6px; border-left: 3px solid var(--color-cyan); }
.auto-deploy-btn { padding: 4px 8px; font-size: 11px; }

.deck-slots { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.slot-item { aspect-ratio: 1/1; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; border: 1px solid transparent; border-radius: 8px; }
.slot-item:hover { border-color: var(--color-empire); color: var(--color-empire); }
.slot-shape { font-size: 16px; margin-bottom: 4px; font-family: monospace; font-weight: bold; padding: 3px 6px; background: var(--overlay-hover); border-radius: 4px; }
.slot-name { font-size: 10px; font-weight: 800; text-align: center; line-height: 1.2;}
.empty-slot { font-size: 24px; color: var(--color-border-emphasized); font-family: monospace; }

.synergy-list { display: flex; flex-wrap: wrap; gap: 6px; overflow-y: auto; }
.synergy-item { background: var(--neo-surface); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--neo-surface-raised); display: inline-flex; align-items: baseline; gap: 6px; width: auto; flex: 1 1 calc(50% - 6px); }
.active-syn { border-color: var(--color-cyan); box-shadow: inset 0 0 8px var(--color-cyan)33; }
.syn-name { font-size: 11px; font-weight: 800; color: var(--color-cyan); white-space: nowrap; }
.syn-desc { font-size: 10px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.can-upgrade { border: 1px solid var(--color-green); box-shadow: 0 0 15px rgba(16, 185, 129, 0.2), inset 4px 4px 8px var(--neo-surface-inset), inset -4px -4px 8px var(--neo-surface-raised); }
.can-upgrade-btn { color: var(--color-green); border-color: var(--color-green); }

.barracks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px; padding: 5px; overflow-y: auto; flex: 1; }
.troop-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; width: 100%; position: relative; }
.in-deck { border: 1px solid var(--color-cyan); }
.quality-badge { position: absolute; top: 10px; right: 10px; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; color: var(--color-text-primary); }
.q-1 { background: var(--color-text-secondary); } .q-2 { background: var(--color-green); } .q-3 { background: var(--color-alliance); } .q-4 { background: var(--color-purple); } .q-5 { background: var(--color-warning); }

.troop-header { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
.neo-icon-inset { width: 36px; height: 36px; box-shadow: inset 3px 3px 6px var(--neo-surface-inset), inset -3px -3px 6px var(--neo-surface-inset); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--color-text-primary); flex-shrink:0; font-family: monospace; font-weight: bold; }
.level-tag { background: var(--neo-surface); padding: 2px 6px; border-radius: 4px; font-size: 10px; color: var(--color-text-secondary); margin-left: 6px; }
.tags-row { font-size: 11px; color: var(--color-text-disabled); margin-top: 4px; }
.btn-equip { padding: 6px 12px; font-size: 11px; }
.troop-stats-bars { padding: 10px; font-size: 11px; font-weight: 600; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 6px; }

.box-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; }
.box-card { padding: 20px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; width: 100%; }

.editor-screen { display: flex; flex-direction: column; width: 100vw; height: 100vh; overflow: hidden; }
.editor-top-bar { padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.editor-title { font-weight: 800; font-size: 14px; color: var(--color-text-primary); }
.editor-actions { display: flex; gap: 8px; align-items: center; }
.btn-editor-toolbar { height: 36px; flex-shrink: 0; padding: 0 12px; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.editor-body { flex: 1; display: flex; flex-direction: row; overflow: hidden; position: relative; height: calc(100vh - 60px); }
#editor-canvas-container { flex: 1; height: 100%; min-width: 0; min-height: 0; overflow: hidden; position: relative; }
#editor-canvas-container canvas { width: 100% !important; height: 100% !important; object-fit: contain; }
.editor-sidebar-tools { width: 220px; padding: 20px; display: flex; flex-direction: column; gap: 15px; flex-shrink: 0; overflow-y: auto; }
.brush-list { display: flex; flex-direction: column; gap: 10px; }
.brush-btn { padding: 12px; display: flex; align-items: center; gap: 10px; font-size: 13px; height: auto; flex-shrink: 0; }
.brush-color { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }

.game-screen { display: block; width: 100vw; height: 100vh; position: relative; }
.ui-header { 
  position: absolute; top: 15px; left: 50%; transform: translateX(-50%); width: 96%;
  padding: 10px 15px; display: flex; justify-content: space-between; align-items: center;
  z-index: 10;
}
.faction-infos { display: flex; gap: 10px; flex-wrap: wrap; }
.side-info { font-size: 12px; font-weight: 800; padding: 6px 12px; color: var(--color-text-primary); }
.mini-gold { color: var(--color-warning); font-size: 11px; margin-top: 2px; }

.ui-controls { display: flex; gap: 10px; align-items: center; }
.btn-ctrl { padding: 8px 16px; font-size: 12px; }
.active-bomb { color: var(--color-empire) !important; border-color: var(--color-empire) !important; box-shadow: inset 3px 3px 6px rgba(239, 68, 68, 0.2), inset -3px -3px 6px var(--neo-surface-inset) !important; }

.speed-gear-container { padding: 4px; display: flex; gap: 4px; }
.btn-speed { background: transparent; border: none; color: var(--color-text-disabled); font-size: 11px; font-weight: 600; padding: 4px 10px; cursor: pointer; border-radius: 8px; transition: color 0.2s; }
.btn-speed.active { color: var(--color-cyan); text-shadow: 0 0 8px rgba(6, 182, 212, 0.5); }

#phaser-canvas-container { display: block; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; z-index: 0; }

.map-legend {
  position: absolute; bottom: 80px; left: 20px; top: auto; display: flex; flex-direction: column; gap: 8px;
  padding: 15px; z-index: 5; background: rgba(17, 24, 39, 0.85); backdrop-filter: blur(8px); border: 1px solid var(--overlay-border); border-radius: 12px;
}
.legend-title { font-size: 12px; font-weight: 800; color: var(--color-text-primary); border-bottom: 1px solid var(--overlay-border); padding-bottom: 6px; margin-bottom: 4px; }
.legend-item { font-size: 11px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
.legend-item .icon { font-family: monospace; font-size: 14px; font-weight: bold; width: 16px; text-align: center; }

.ui-footer { 
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 10px 24px; border-radius: 99px; font-size: 12px; color: var(--color-text-secondary); z-index: 10; font-weight: 800;
}

.modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(11, 12, 16, 0.8); backdrop-filter: blur(8px); display: flex; justify-content: center; align-items: center; z-index: 999; }
.modal-content { padding: 40px; max-width: 400px; width: 90%; text-align: center; }
.modal-title { font-size: 24px; font-weight: 800; margin-bottom: 10px; color: var(--color-text-primary); }
.modal-desc { color: var(--color-text-secondary); font-weight: 600; margin-bottom: 20px; }
.settlement-rewards { padding: 20px; text-align: left; color: var(--color-text-primary); font-weight: 600; line-height: 2; margin-bottom: 24px; }

.animate-fade { animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 768px) {
  .menu-screen { flex-direction: column; overflow-x: hidden; }
  
  .menu-sidebar { 
    position: fixed !important; top: auto !important; bottom: 0 !important; left: 0 !important; right: 0 !important;
    width: 100vw !important; height: 65px !important; flex-direction: row !important; justify-content: space-around !important;
    align-items: center !important; padding: 0 !important; margin: 0 !important; border-right: none !important; border-top: 2px solid var(--color-border) !important; z-index: 999 !important;
  }
  .menu-sidebar.is-collapsed { width: 100vw !important; }
  .menu-sidebar-spacer { display: none !important; }
  
  .sidebar-header { display: none !important; }
  .hidden-on-mobile { display: none !important; }
  .mobile-only-text { display: inline-block; }
  
  .menu-nav { flex-direction: row; margin-top: 0; width: 100%; justify-content: space-around; gap: 0; }
  .btn-nav-item { 
    width: 25% !important; flex-direction: column !important; gap: 4px !important;
    padding: 6px 0 !important; margin: 0 !important; box-shadow: none !important; border: none !important; background: transparent !important;
  }
 
  .nav-text { display: block !important; font-size: 10px; font-weight: 800; text-align: center; color: var(--color-text-disabled); white-space: nowrap; }
  .btn-nav-item.active .nav-text { color: var(--color-cyan); }
  
  .menu-main-content { padding: 10px 10px 75px 10px; display: block; overflow-y: auto; height: auto; }
  .content-wrapper { gap: 10px; }
  
  .global-resource-bar { padding: 10px; flex-direction: column; gap: 10px; align-items: stretch; margin-bottom: 0; }
  .res-group { justify-content: space-between; }
  .res-item { font-size: 12px; }
  
  .tab-panel { gap: 15px; padding: 0; overflow-y: visible; }
  .setup-controls-grid { grid-template-columns: 1fr; gap: 15px; }
  .panel-title { font-size: 13px; margin-bottom: 8px; }
  .neo-select { padding: 12px 14px; font-size: 13px; }
  
  .preview-board { padding: 16px; min-height: auto; }
  .preview-header h3 { font-size: 16px; }
  .detail-item { flex-direction: column; gap: 4px; }
  
  .start-action-zone { margin-top: 5px; padding-top: 0;}
  .btn-launch-game { width: 100%; padding: 14px; font-size: 14px; }

  .deck-top-section { flex-direction: column; gap: 15px; }
  .slot-name { font-size: 9px; }
  
  .synergy-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .synergy-item { width: calc(50% - 3px); flex: none; }

  .ui-header { top: 5px; width: 98%; padding: 8px; flex-direction: column; gap: 8px; border-radius: 12px; }
  .faction-infos { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .side-info { padding: 6px; font-size: 11px; }
  .faction-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ui-controls { width: 100%; justify-content: space-between; gap: 6px; }
  .btn-ctrl { flex: 1; padding: 8px 0; text-align: center; font-size: 11px; }
  
  .ui-footer { bottom: 5px; padding: 8px 12px; font-size: 10px; width: 95%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  
  .editor-top-bar { flex-wrap: wrap; justify-content: center; gap: 5px; padding: 5px; }
  .editor-body { flex-direction: column; height: auto; }
  .editor-canvas-pane { flex: none; height: 50vh; width: 100%; }
  .editor-sidebar-tools { width: 100%; flex: 1; flex-direction: row; flex-wrap: wrap; padding: 10px; gap: 5px; height: auto; overflow: visible; }
  .brush-list { flex-direction: row; flex-wrap: wrap; gap: 5px; }
  .brush-btn { padding: 6px 10px; font-size: 11px; height: auto; }
}

@media (min-width: 769px) {
  .mobile-only-text { display: none; }
}

/* ================= 舰队跟随 UI 样式 ================= */
.fleet-ui-layer {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 20; 
  overflow: hidden;
}

.fleet-float-ui {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex; align-items: center; gap: 6px;
  background: rgba(11, 12, 16, 0.85);
  border: 1px solid var(--overlay-border);
  padding: 4px 6px; border-radius: 6px;
  will-change: left, top;
  pointer-events: auto;
}

.fleet-portrait { width: 28px; height: 36px; object-fit: cover; border-radius: 3px; border: 1px solid var(--color-border); background: var(--neo-surface-raised); }
.fleet-info { display: flex; flex-direction: column; gap: 4px; width: 90px; }
.fleet-name { font-size: 11px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1; }
.fleet-hp-bar { width: 100%; height: 4px; background: var(--color-border); border-radius: 2px; overflow: hidden; }
.hp-fill { height: 100%; transition: width 0.1s linear; }
.bg-cyan { background: var(--color-cyan); }
.bg-red { background: var(--color-empire); }

.stance-controls { display: flex; gap: 2px; margin-top: 4px; pointer-events: auto; }
.stance-btn { flex: 1; background: var(--neo-surface); border: 1px solid var(--color-border); color: var(--color-text-disabled); font-size: 9px; font-weight: 800; padding: 2px 0; border-radius: 3px; cursor: pointer; transition: all 0.2s; }
.stance-btn.active { background: var(--color-cyan); color: var(--neo-surface); border-color: var(--color-cyan); }
</style>