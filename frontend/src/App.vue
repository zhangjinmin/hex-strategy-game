<template>
  <div id="game-container" v-if="isDataLoaded">
    <TitleScreen v-if="gameState === 'title'" />
    <MainMenu v-if="gameState === 'menu'" />
    <SimScreen v-if="gameState === 'sim'" />

    <div v-if="gameState === 'game'" class="game-screen" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; z-index: 999;">
      <GameHeader />
      <div id="phaser-canvas-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></div>


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

      <!-- [v36c] 空域地形图例。地形此前只存在于"世界里的颜色"里，界面无任何解释
           ⇒ 用户实报"地图里说有各种空域地形，界面上什么都没有"。 -->
      <div class="terrain-legend" :class="{ 'tl-collapsed': !terrainLegendOpen }">
        <div class="tl-head" @click="terrainLegendOpen = !terrainLegendOpen">
          <span class="tl-title">空域地形</span>
          <span class="tl-toggle">{{ terrainLegendOpen ? '−' : '+' }}</span>
        </div>
        <template v-if="terrainLegendOpen">
          <div v-if="!terrainEnabled" class="tl-off">地形效果已关闭（仅显示，无数值影响）</div>
          <div v-for="row in terrainLegend" :key="row.id" class="tl-row">
            <span class="tl-dot" :style="{ background: row.color, boxShadow: '0 0 6px ' + row.color }"></span>
            <span class="tl-name">{{ row.label }}</span>
            <span class="tl-desc">{{ row.desc }}</span>
          </div>
        </template>
      </div>

      <!-- 3D 战场视角预设（27° 侧视 / 正俯视）：3D 就绪后显示 -->
      <div v-if="is3dBattle && battle3dReady" class="view-preset-group">
        <button class="view-preset-btn" title="27° 侧视" @click="setViewPreset('tilt')">27°</button>
        <button class="view-preset-btn" title="正俯视" @click="setViewPreset('top')">俯视</button>
      </div>

      <!-- 提督扮演：军议面板（仅指挥制）+ 关闭态的开启按钮（显著化：任务指令唯一入口） -->
      <CouncilWarRoom v-if="isCommandBattle" />
      <!-- [G4] 战前部署「入场仪式」全屏层（立绘 / 致辞 / 对阵）—— 纯叠加，不改既有部署逻辑；
           可见性由组件内部按 store.battleDeployPhase 判定 -->
      <BattleIntroOverlay v-if="isCommandBattle" />
      <button v-if="isCommandBattle && !warRoomOpen" class="war-room-toggle" @click="setWarRoomOpen(true)">⚔ 军议 · 任务指令</button>

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
      @execute="handleCommandExecute"
      @cancel="handleCommandCancel"
      @cancel-target="handleCommandCancelTarget"
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
import { mountGame, unmountGame, getGameInstance } from './game/GameInstance';

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
import CouncilWarRoom from './components/battle/CouncilWarRoom.vue';
import BattleIntroOverlay from './components/battle/BattleIntroOverlay.vue';
import BattleLogPanel from './components/battle/BattleLogPanel.vue';
import ForcePassDialog from './components/meta/ForcePassDialog.vue';
import { commandBridge } from './services/CommandBridge';
import { initMusic, unlockAudio, setEnabled, setVolume } from './services/MusicManager';
import { Battle3DOverlay } from './game/three/Battle3DOverlay';
// [v36c] 战场地形图例：数据由 `terrainEffects` 的**效果表推导**（不手抄），
//   保证图例文案与实装数值永不脱节。
import { terrainLegendRows } from './config/terrainEffects';
import { TERRAIN_RULES } from './config/balance';

const store = useGameStore();
const settings = useSettingsStore();
const showSaveModal = ref(false);
const showBriefing = ref(false);
const battleLogRef = ref<InstanceType<typeof BattleLogPanel> | null>(null);

// 指挥面板状态（由 BattleScene 通过 commandBridge 控制）
const showCommandPanel = computed(() => commandBridge.visible);

// [2a] Vue → BattleScene 通道：优先直接取场景实例（与 setBattleSceneVisible / tryCreate3dOverlay 同口径）。
// BattleScene 的指挥链路方法经此调用；未就绪（headless / 未挂载）时返回 null，由调用方兜底。
function battleSceneApi(): any {
  try { return getGameInstance()?.scene?.getScene('BattleScene'); } catch { return null; }
}

// ① 非目标命令 → 执行（pendingCallback 内层 if(selectedAbilityId) 现为真）然后关面板
function handleCommandExecute() {
  // [2a-2] BUG-1 契约层双保险（根因修复在 BattleScene.executeCommandFromPanel）：
  //   本路径不经 closeCommandPanel，若不清退态，残留的 cpCommandMode/targetCandidates
  //   会让随后的战场点击触发幽灵执行。exitTargetSelect 幂等，可放心前置。
  battleSceneApi()?.exitTargetSelect?.('execute-other');
  if (commandBridge.pendingCallback) {
    commandBridge.pendingCallback(null);
  }
  commandBridge.visible = false;
}

// ② 取消（✕ / 列表态 Esc / 再次点选中卡片）→ 丢弃 callback，关面板，退选目标态，恢复实时。
//    **绝不执行、绝不扣 CP**（07 §5.3：CP 只在 executeCommand 内扣除）。
function handleCommandCancel() {
  commandBridge.pendingCallback = null;
  const bs = battleSceneApi();
  if (bs?.closeCommandPanel) {
    bs.closeCommandPanel();
  } else {
    // 兜底（场景未就绪）：只清桥 + 恢复实时
    commandBridge.visible = false;
    commandBridge.selectedAbilityId = null;
    (store as any).isPaused = false;
  }
}

// ③ 目标命令 → 进入选目标态（面板保持打开，暂停不解除，不扣 CP）
function handleCommandSelectTarget(abilityId: string) {
  commandBridge.selectedAbilityId = abilityId;
  battleSceneApi()?.enterTargetSelect?.(abilityId);
}

// ④ 退选目标态回列表（面板不关、暂停不解除）
function handleCommandCancelTarget() {
  commandBridge.selectedAbilityId = null;
  battleSceneApi()?.exitTargetSelect?.('cancel-target');
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

// ===== 3D 战场覆盖层 =====
// 战斗（演习 / 战役）一律走 Three.js 覆盖层；BattleScene 只作逻辑引擎 + 降级显示。
// ⚠ 2026-09-20：原 `hex`（星域棋盘）/ `crt`（全息战术投影）/ `3d`（3D 战场）三模式已删除，
//   `tacticalState.mapStyle` 字段不再存在 —— 不要再按模式分流渲染。
const is3dBattle = computed<boolean>(() => gameState.value === 'game');
// 提督扮演：军议面板（战斗期间常驻挂载）
const isCommandBattle = computed<boolean>(() => gameState.value === 'game');
// store 体量过大导致 pinia ref 解包类型推断在个别属性上失效，沿用既有防御式读取口径
const warRoomOpen = computed<boolean>(() => (store.warRoomOpen as any).value ?? store.warRoomOpen);
const setWarRoomOpen = (v: boolean) => { (store as any).warRoomOpen = v; };
// [v36c] 战场地形图例。用户实报"地图里说有各种空域地形，界面上什么都没有"——
//   地形此前只有"世界里的颜色"，没有任何地方解释它是什么、有什么影响。
//   行数据由 `terrainEffects.terrainLegendRows()` 从效果表**推导**（改数值 ⇒ 图例自动跟随）。
const terrainLegend = terrainLegendRows();
const terrainEnabled = TERRAIN_RULES.BATTLE_ENABLED;
// 默认展开；折叠态只留标题条，避免长期占用左下角视野。
const terrainLegendOpen = ref(true);

const battle3dReady = ref(false);
let battle3dOverlay: Battle3DOverlay | null = null;
let battle3dReadyTimer: number | null = null;

const setViewPreset = (p: 'tilt' | 'top') => battle3dOverlay?.setViewPreset(p);

const clear3dReadyTimer = () => {
  if (battle3dReadyTimer !== null) {
    clearTimeout(battle3dReadyTimer);
    battle3dReadyTimer = null;
  }
};

// [v12 P2] 3D 模式下让 Phaser 的 BattleScene **停止 2D 渲染但逻辑照跑**：
//   · SceneManager.render() 只在 sys.settings.visible 为真时渲染该场景（本仓 node_modules 源码 :596）；
//   · SceneManager.update()/sys.step() **不看 visible**（:558-579）⇒ 逻辑/物理/事件照常推进。
//   CSS 只把 2D 画布 visibility:hidden，Phaser 仍每帧完整渲染那块隐藏画布 = 白烧 GPU；
//   置 visible=false 即跳过该场景渲染（本轮性能优化的最大单项）。
//   注：安装版 Phaser 的 SceneManager **没有** setVisible（只有 isVisible），必须走 scene.sys.setVisible()。
const setBattleSceneVisible = (visible: boolean) => {
  // [FIX-2D白渲染] 旧实现一次性调用：enter3dMode 早于 BattleScene.create() 时
  //   getScene 返回 undefined → 静默跳过 → 2D 场景（7000+ 对象）在画布已被 CSS
  //   隐藏的情况下每帧照常全量渲染，实测吃掉 ~65ms/帧（画质调最低也救不回来，
  //   用户实报 20fps）。改为轮询直到场景存在（上限 ~5s），每次成功都按当前
  //   battle3d-mode 真值收敛，乱序/迟到调用均安全。
  const apply = () => {
    try {
      const bs = getGameInstance()?.scene.getScene('BattleScene');
      if (!bs?.sys) return false;
      bs.sys.setVisible(visible);
      return true;
    } catch { return false; }
  };
  if (apply()) return;
  let tries = 0;
  const iv = setInterval(() => {
    if (apply() || ++tries > 20) clearInterval(iv);
  }, 250);
};

/** 销毁 3D 层**实例**（不触碰画布可见性 —— 可见性由 enter3dMode / fallbackTo2D 单独管）。 */
const dispose3dOverlay = () => {
  clear3dReadyTimer();
  battle3dReady.value = false;
  if (battle3dOverlay) {
    battle3dOverlay.destroy();
    battle3dOverlay = null;
  }
  // QA 只读调试口句柄，destroy 后必须清空——否则台架/调试脚本读到已销毁实例的闭包，
  // 会误判 overlay 仍存活（QA-2 §6.4）。
  (window as any).__b3dOverlay = null;
};

/**
 * 进入 3D 呈现：隐藏 2D 画布。
 *
 * ⚡ [2026-09-20] 必须**立刻**调用，不能等 overlay 的 `onReady` —— 旧实现等到 onReady
 *   （约 1~2.5 秒）才隐藏画布，而那 1~2.5 秒里 Phaser 画布可见、画的是一整块六角格棋盘
 *   （用户实报："战场加载的时候会有一瞬间出现棋盘的内容"）。
 *   现在 2D 画布只在「3D 8 秒内建不起来」时由 `fallbackTo2D` 重新显示。
 */
const enter3dMode = () => {
  document.body.classList.add('battle3d-mode');
  // [v12 P2] 同步让 Phaser 停画 BattleScene（逻辑照跑，见 setBattleSceneVisible 注释）
  setBattleSceneVisible(false);
};

/** 降级 / 离开战斗：恢复 2D 画布，保证任何情况下都不会"两块画布都不可见"。 */
const fallbackTo2D = () => {
  dispose3dOverlay();
  document.body.classList.remove('battle3d-mode');
  setBattleSceneVisible(true);
};

const tryCreate3dOverlay = (attempt: number) => {
  if (!is3dBattle.value) return;
  const container = document.getElementById('phaser-canvas-container');
  if (!container || !getGameInstance()) {
    if (attempt < 10) setTimeout(() => tryCreate3dOverlay(attempt + 1), 100);
    return;
  }
  const bs = getGameInstance()!.scene.getScene('BattleScene');
  if (!bs) {
    if (attempt < 10) setTimeout(() => tryCreate3dOverlay(attempt + 1), 100);
    return;
  }
  dispose3dOverlay();
  const ov = new Battle3DOverlay(container, bs, store, {
    onReady: () => {
      // 3D 已确认渲染出地形：只标记就绪（供视角预设按钮显示）。
      // ⚠ 画布可见性**不在这里切** —— 见 enter3dMode 的注释。
      if (battle3dOverlay === ov) {
        clear3dReadyTimer();
        battle3dReady.value = true;
      }
    },
  });
  battle3dOverlay = ov;
  // [QA 只读调试口 v6] 独立验证用：暴露 overlay 实例（纯读取，不参与渲染逻辑）。
  // 供 _v6_dot_lattice_probe.cjs 逐档隔离光点层/标记层、读 drawRange/相机距离做像素级证据。
  // （销毁时置 null，见 dispose3dOverlay）
  (window as any).__b3dOverlay = ov;
  // 降级兜底：8 秒内 3D 没就绪 → 销毁 overlay，回退 2D 渲染
  battle3dReadyTimer = window.setTimeout(() => {
    if (battle3dOverlay === ov && is3dBattle.value) {
      console.warn('[App.vue] 3D overlay not ready in 8s, falling back to 2D');
      fallbackTo2D();
    }
  }, 8000);
};

// 进入 / 离开战斗时挂 / 卸 3D 覆盖层
watch(is3dBattle, (on) => {
  if (on) {
    // ⚡ 先隐藏 2D 画布（消除棋盘闪现），再等 mountGame 完成
    //   （watch(gameState) 里 Phaser 挂载有 100ms 重试）
    enter3dMode();
    setTimeout(() => tryCreate3dOverlay(1), 300);
  } else {
    fallbackTo2D();
  }
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
    // [2a] 命令面板/选目标态下，Esc 归命令系统处理（取消/退选），**不退出战斗**
    if (commandBridge.visible) return;
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

const handleResize = () => { battle3dOverlay?.resize(); };

onMounted(async () => {
  await store.initLoadData();
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', handleResize);

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
  window.removeEventListener('resize', handleResize);
  fallbackTo2D();
});

// 监听设置变化 → 同步到音乐播放器
watch(() => (settings as any).musicEnabled, (v: boolean) => setEnabled(v));
watch(() => (settings as any).musicVolume,  (v: number) => setVolume(v));

// UI 缩放因子：统一放大全局字体/按钮/菜单，解决"整体文字太小"问题
// v3 修复（军议面板/全屏容器溢出）：原方案在 html 根级设 CSS zoom。
//   zoom 会缩放像素值，但 100vw/100vh 视口单位**不参与 zoom 折算**：
//   width:100vw 的元素实际渲染宽度 = zoom × 视口宽 → 整体向右溢出 (zoom-1)×视宽，
//   锚定在该容器 right:12px 的军议面板随之超出屏幕（窗口越小溢出越明显，实报截图吻合）。
//   改为把 zoom 作用在 #game-container（其宽度 100% 跟随已缩放后的父级布局，
//   不用 vw 单位），并对 body 显式锁 zoom:1 兜底；全屏容器一律改用
//   fixed + inset:0 或 100%（百分比受 zoom 影响一致，不会溢出）。
const applyUiScale = (n: number) => {
  const root = document.documentElement;
  const container = document.getElementById('game-container');
  const factor = Math.max(0.8, Math.min(1.4, n / 100));
  (root.style as any).zoom = '1';
  if (container) (container.style as any).zoom = factor.toFixed(3);
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

*, *::before, *::after { box-sizing: border-box; font-family: 'Inter', sans-serif; }

html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }

#game-container {
  display: block; width: 100%; height: 100vh; margin: 0; padding: 0; overflow: hidden;
  background: var(--color-background-body); color: var(--color-text-primary);
  font-family: var(--font-family);
}
/* v3：UI 缩放 zoom 作用于本容器（见 applyUiScale 注释），高度用 fixed 视口锁定避免 vh/zoom 溢出 */
#game-container:has(.game-screen) { height: 100%; }

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

.menu-screen { display: flex; width: 100%; height: 100vh; overflow: hidden; text-align: center; }
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

.editor-screen { display: flex; flex-direction: column; width: 100%; height: 100vh; overflow: hidden; }
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

.game-screen { display: block; width: 100%; height: 100%; position: relative; }
/* v3 修复（顶栏位置全错）：此处的 .ui-header/.faction-infos/.side-info/.ui-controls/
   .btn-ctrl/.speed-gear-container/.btn-speed 全局旧规则已删除——GameHeader/GameControls
   均有 scoped 版本，而旧全局规则里的 transform:translateX(-50%) + width:96% 未被覆盖，
   会把整个顶栏左移半个自身宽度（倍速按钮跑到屏幕中央、左上舰队卡被裁掉一半，实报截图吻合）。
   保留 .active-bomb（GameControls 依赖其 !important 覆盖 neo-btn 底样式）。 */
.active-bomb { color: var(--color-empire) !important; border-color: var(--color-empire) !important; box-shadow: inset 3px 3px 6px rgba(239, 68, 68, 0.2), inset -3px -3px 6px var(--neo-surface-inset) !important; }

#phaser-canvas-container { display: block; width: 100%; height: 100%; position: absolute; top: 0; left: 0; z-index: 0; }

/* 3D 视角预设按钮组（右下角，3D 就绪后显示） */
.view-preset-group { position: absolute; right: 16px; bottom: 70px; display: flex; flex-direction: column; gap: 8px; z-index: 20; }
.view-preset-btn { padding: 8px 12px; font-size: 12px; font-weight: 800; color: var(--color-cyan); background: var(--overlay-surface, rgba(10,16,28,0.75)); border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; backdrop-filter: blur(4px); transition: all 0.2s; }
.view-preset-btn:hover { background: var(--color-cyan); color: var(--neo-surface, #0a0f1c); }
/* 提督扮演：军议面板关闭态的开启按钮（指挥制）。top 与 CouncilWarRoom 面板对齐（170px） */
.war-room-toggle { position: absolute; right: 16px; top: 170px; z-index: 20; padding: 10px 16px; font-size: 13px; font-weight: 900; letter-spacing: 1px; color: #22d3ee; background: rgba(10,16,28,0.85); border: 2px solid rgba(34,211,238,0.65); border-radius: 8px; cursor: pointer; backdrop-filter: blur(4px); box-shadow: 0 0 12px rgba(34,211,238,0.25); animation: war-room-pulse 2.2s ease-in-out infinite; }
@keyframes war-room-pulse { 0%, 100% { box-shadow: 0 0 8px rgba(34,211,238,0.2); } 50% { box-shadow: 0 0 18px rgba(34,211,238,0.5); } }
.war-room-toggle:hover { background: #22d3ee; color: #0a0f1c; }

/* ===== 3D 战场模式：隐藏 Phaser 画布与依赖 2D 坐标的跟随层 =====
   逻辑引擎（BattleScene）照常运行，仅隐藏 2D 呈现；GameHeader 读 store 数据不受影响 */
body.battle3d-mode #phaser-canvas-container canvas { visibility: hidden; }
body.battle3d-mode .fleet-ui-layer { display: none; }

.map-legend {
  position: absolute; bottom: 80px; left: 20px; top: auto; display: flex; flex-direction: column; gap: 8px;
  padding: 15px; z-index: 5; background: rgba(17, 24, 39, 0.85); backdrop-filter: blur(8px); border: 1px solid var(--overlay-border); border-radius: 12px;
}
.legend-title { font-size: 12px; font-weight: 800; color: var(--color-text-primary); border-bottom: 1px solid var(--overlay-border); padding-bottom: 6px; margin-bottom: 4px; }
.legend-item { font-size: 11px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
.legend-item .icon { font-family: monospace; font-size: 14px; font-weight: bold; width: 16px; text-align: center; }

/* [v36c] 空域地形图例（战场左下角）。独立命名，避免与战略地图的 .map-legend 耦合 */
.terrain-legend {
  position: absolute; bottom: 78px; left: 20px; z-index: 10;
  display: flex; flex-direction: column; gap: 5px;
  padding: 10px 12px; min-width: 216px;
  background: rgba(10, 16, 28, 0.82); backdrop-filter: blur(8px);
  border: 1px solid rgba(34, 211, 238, 0.28); border-radius: 10px;
  pointer-events: auto;
}
.terrain-legend .tl-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; }
.terrain-legend .tl-title { font-size: 11px; font-weight: 900; letter-spacing: 1px; color: #22d3ee; }
.terrain-legend .tl-toggle { font-size: 12px; font-weight: 900; color: var(--color-text-secondary); width: 12px; text-align: center; }
.terrain-legend .tl-row { display: flex; align-items: center; gap: 7px; font-size: 10px; line-height: 1.3; }
.terrain-legend .tl-dot { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
.terrain-legend .tl-name { color: var(--color-text-primary); font-weight: 800; width: 62px; flex: 0 0 auto; }
.terrain-legend .tl-desc { color: var(--color-text-secondary); font-weight: 600; }
.terrain-legend .tl-off { font-size: 10px; color: var(--color-warning); font-weight: 800; }
.terrain-legend.tl-collapsed { min-width: 0; }

.ui-footer { 
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 10px 24px; border-radius: 99px; font-size: 12px; color: var(--color-text-secondary); z-index: 10; font-weight: 800;
}

.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(11, 12, 16, 0.8); backdrop-filter: blur(8px); display: flex; justify-content: center; align-items: center; z-index: 999; }
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

  /* v3：顶栏全局旧规则已删（见上方 .active-bomb 注释），移动端残留一并移除；
     GameHeader.vue scoped 内有自己的 @media 规则 */

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