<template>
  <div class="strategic-screen" :class="{ 'mode-universe': starmapMode === 'universe' }">
    <!-- ===== 顶部中央：核心 Tab 导航（全局共用顶部条，常驻、可点击，不随 starmap-layer 隐藏） ===== -->
    <!-- 修复：切到军务/军议院/经济等面板时 starmap-layer 被 v-show 隐藏，nav 若嵌在里面会一起消失导致无法切回星图。
         故抽到 .strategic-screen 根层级（z-index:60），switchTab 始终可用。
         悬浮板模式(holo) 使用此独立 .nav-bar；宇宙模式(universe) 用下方 .universe-topbar（内含导航），两者互斥不叠置。 -->
    <div v-show="starmapMode !== 'universe'" class="nav-bar" :class="factionNavClass">
      <nav class="holo-nav-group">
        <button @click="switchTab('starmap')" class="holo-tab" :class="{active: currentTab === 'starmap'}">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/><line x1="8" y1="0" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="16"/><line x1="0" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="16" y2="8"/></svg></span><span class="tab-text">星图</span>
        </button>
        <button @click="switchTab('military')" class="holo-tab" :class="{active: currentTab === 'military'}">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1L2 5v6l6 4 6-4V5L8 1z"/><path d="M8 5v6"/><path d="M5 7l3 2 3-2"/></svg></span><span class="tab-text">军务</span>
        </button>
        <button @click="switchTab('council')" class="holo-tab" :class="{active: currentTab === 'council'}">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 14h12"/><path d="M3 10h10"/><path d="M4 6h8"/><path d="M5 6V3l3-2 3 2v3"/><line x1="8" y1="10" x2="8" y2="14"/></svg></span><span class="tab-text">军议院</span>
          <span v-if="(store as any).councilPendingCount > 0" class="badge-dot">{{ (store as any).councilPendingCount }}</span>
        </button>
        <button @click="switchTab('economy')" class="holo-tab" :class="{active: currentTab === 'economy'}">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1M1.5 8h1M8 15v-1M15 8h-1"/></svg></span><span class="tab-text">经济</span>
        </button>
      </nav>
    </div>

    <!-- ===== 宇宙模式(universe)顶部长条信息框：合并原四角信息板 + 内含导航，常驻，仅在宇宙模式显示 ===== -->
    <div v-show="starmapMode === 'universe'" class="universe-topbar" :class="factionNavClass">
      <!-- 第1行：交互（导航 + 军官信息 + 暂停/推进 + 倍速 + 名册/关系网/存档/演训） -->
      <div class="ut-row ut-row-main">
        <nav class="holo-nav-group">
          <button @click="switchTab('starmap')" class="holo-tab" :class="{active: currentTab === 'starmap'}">
            <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/><line x1="8" y1="0" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="16"/><line x1="0" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="16" y2="8"/></svg></span><span class="tab-text">星图</span>
          </button>
          <button @click="switchTab('military')" class="holo-tab" :class="{active: currentTab === 'military'}">
            <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1L2 5v6l6 4 6-4V5L8 1z"/><path d="M8 5v6"/><path d="M5 7l3 2 3-2"/></svg></span><span class="tab-text">军务</span>
          </button>
          <button @click="switchTab('council')" class="holo-tab" :class="{active: currentTab === 'council'}">
            <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 14h12"/><path d="M3 10h10"/><path d="M4 6h8"/><path d="M5 6V3l3-2 3 2v3"/><line x1="8" y1="10" x2="8" y2="14"/></svg></span><span class="tab-text">军议院</span>
            <span v-if="(store as any).councilPendingCount > 0" class="badge-dot">{{ (store as any).councilPendingCount }}</span>
          </button>
          <button @click="switchTab('economy')" class="holo-tab" :class="{active: currentTab === 'economy'}">
            <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1M1.5 8h1M8 15v-1M15 8h-1"/></svg></span><span class="tab-text">经济</span>
          </button>
        </nav>

        <div class="ut-divider"></div>

        <!-- 军官信息 -->
        <div class="ut-officer">
          <img v-if="playerPortrait" :src="playerPortrait" class="ut-avatar" />
          <div class="ut-officer-detail">
            <span class="ut-rank text-cyan">{{ playerRank }}</span>
            <span class="ut-name">{{ playerName }}</span>
          </div>
        </div>

        <div class="ut-divider"></div>

        <!-- 暂停 / 推进 + 倍速 -->
        <div class="ut-time">
          <button @click="togglePause" class="holo-btn ut-time-pause" :class="isPaused ? 'text-gold' : 'text-cyan'">
            <svg v-if="isPaused" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><polygon points="3,1 13,8 3,15"/></svg>
            <svg v-else viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><rect x="2" y="1" width="4" height="14"/><rect x="10" y="1" width="4" height="14"/></svg>
            {{ isPaused ? '推进' : '暂停' }}
          </button>
          <div class="ut-speed">
            <button v-for="sp in [0.5, 1, 2, 3]" :key="sp" @click="(store as any).strategicTimeSpeed = sp" class="holo-btn holo-btn-xs" :class="(store as any).strategicTimeSpeed === sp ? 'active-speed' : ''">x{{ sp }}</button>
          </div>
        </div>

        <div class="ut-divider"></div>

        <!-- 名册 / 关系网 / 存档 / 演训 -->
        <div class="ut-tools">
          <button @click="showRoster = true" class="holo-icon" title="提督名册"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="4" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg></button>
          <button @click="showNetwork = true" class="holo-icon" title="提督关系网"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="3" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="13" cy="12" r="2"/><line x1="8" y1="5" x2="3" y2="10"/><line x1="8" y1="5" x2="13" y2="10"/><line x1="5" y1="12" x2="11" y2="12"/></svg></button>
          <button @click="$emit('open-save')" class="holo-icon" title="存档"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 15H3a1 1 0 01-1-1V2a1 1 0 011-1h8l3 3v10a1 1 0 01-1 1z"/><path d="M5 1v4h5V1"/><rect x="5" y="9" width="6" height="4" rx="0.5"/></svg></button>
          <button @click="openSimMode" class="holo-icon" title="战术演训"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13l4-4"/><path d="M7 3l6 6-4 4-6-6 4-4z"/><path d="M9 5l2 2"/></svg></button>
          <button @click="showBrowser = true" class="holo-icon" title="银河百科"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z"/><line x1="8" y1="3.5" x2="8" y2="13.5"/></svg></button>
        </div>
      </div>

      <!-- 第2行：数值（键+值紧凑排布） -->
      <div class="ut-row ut-row-info">
        <span class="ut-stat"><span class="ut-k">战力</span><span class="ut-v">{{ warSituation.myShips.toLocaleString() }} 舰</span></span>
        <span class="ut-stat"><span class="ut-k">敌军</span><span class="ut-v">{{ warSituation.enemyShips.toLocaleString() }} 舰</span></span>
        <span class="ut-stat"><span class="ut-k">我方星域</span><span class="ut-v">{{ warSituation.myNodes }} 星</span></span>
        <span class="ut-stat"><span class="ut-k">敌方星域</span><span class="ut-v">{{ warSituation.enemyNodes }} 星</span></span>
        <span class="ut-stat"><span class="ut-k">警戒</span><span class="ut-v" :class="warSituation.advantage === '劣势' ? 'text-red' : warSituation.advantage === '优势' ? 'text-green' : 'text-gold'">{{ alertLabel }}</span></span>
        <span class="ut-stat"><span class="ut-k">阶段</span><span class="ut-v" :class="warSituation.advantage === '劣势' ? 'text-red' : warSituation.advantage === '优势' ? 'text-green' : 'text-gold'">{{ phaseLabel }}</span></span>
        <span class="ut-stat"><span class="ut-k">宇宙历</span><span class="ut-v text-gold">{{ universeDate }}</span></span>
        <span class="ut-stat"><span class="ut-k">金币</span><span class="ut-v text-gold">₮ {{ formatGold((store as any).metaGold) }}</span></span>
      </div>
    </div>

    <!-- 星图层 (默认) — 使用 v-show 保持 canvas DOM 不被销毁 -->
    <div v-show="currentTab === 'starmap'" class="tab-content starmap-layer">
      <div id="strategic-canvas-container" class="canvas-layer"></div>

      <!-- ===== 取消整条顶部导航栏 → 信息全部下沉到四角悬浮全息屏 ===== -->

      <!-- ===== 左上：军情简报（锚点投影定位 + 自身 3D 立牌，垂直托盘、随地图侧转） ===== -->
      <div ref="brieRef" v-show="starmapMode === 'holo'" class="holo-slot brie-slot" :style="holoStyle('brie')">
        <div class="holo-board holo-brie">
          <div class="hb-head"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12M2 8h12M2 13h8"/></svg>军情简报</div>
          <div class="hb-row"><span class="hb-k">本军战力</span><span class="hb-v">{{ warSituation.myShips.toLocaleString() }} 舰</span></div>
          <div class="hb-row"><span class="hb-k">敌军战力</span><span class="hb-v">{{ warSituation.enemyShips.toLocaleString() }} 舰</span></div>
          <div class="hb-row"><span class="hb-k">战局判定</span><span class="hb-v" :class="warSituation.advantage === '优势' ? 'text-green' : warSituation.advantage === '劣势' ? 'text-red' : 'text-gold'">{{ warSituation.advantage }}</span></div>
          <div class="hb-div"></div>
          <div class="hb-row"><span class="hb-k">我方星域</span><span class="hb-v">{{ warSituation.myNodes }} 星</span></div>
          <div class="hb-row"><span class="hb-k">敌方星域</span><span class="hb-v">{{ warSituation.enemyNodes }} 星</span></div>
          <div class="hb-div"></div>
          <div class="hb-log">· 补给线：畅通</div>
          <div class="hb-log">· 跃迁引擎：READY</div>
        </div>
      </div>

      <!-- ===== 右上：战术雷达（锚点投影定位 + 自身 3D 立牌，垂直托盘、随地图侧转） ===== -->
      <div ref="radarRef" v-show="starmapMode === 'holo'" class="holo-slot radar-slot" :style="holoStyle('radar')">
        <div class="holo-board holo-radar">
          <div class="hb-head"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/><line x1="8" y1="0" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="16"/></svg>战术雷达</div>
          <div class="hb-row"><span class="hb-k">警戒等级</span><span class="hb-v text-gold">DEFCON 2</span></div>
          <div class="hb-row"><span class="hb-k">战略阶段</span><span class="hb-v">对峙</span></div>
          <div class="hb-div"></div>
          <div class="hb-row"><span class="hb-k">战力比</span><span class="hb-v">{{ warSituation.ratioLabel }}</span></div>
          <div class="hb-mini">
            <div class="hb-mini-track"><div class="hb-mini-mine" :style="{ width: Math.min(100, (warSituation.myShips / Math.max(1, warSituation.myShips + warSituation.enemyShips)) * 100) + '%' }"></div></div>
            <span class="hb-mini-label">我 {{ warSituation.myShips.toLocaleString() }} / 敌 {{ warSituation.enemyShips.toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <!-- ===== 左下：玩家信息 + 时间控制（锚点投影定位 + 自身 3D 立牌，垂直托盘、随地图侧转） ===== -->
      <div ref="rosterRef" v-show="starmapMode === 'holo'" class="holo-slot roster-slot" :style="holoStyle('roster')">
        <div class="holo-board holo-roster">
          <div class="hb-head"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="4" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>指挥官</div>
          <div class="hb-player">
            <img v-if="playerPortrait" :src="playerPortrait" class="hb-avatar" />
            <div class="hb-player-detail">
              <span class="hb-rank text-cyan">{{ playerRank }}</span>
              <span class="hb-name">{{ playerName }}</span>
            </div>
            <span class="hb-gold text-gold">₮ {{ formatGold((store as any).metaGold) }}</span>
          </div>
          <div class="hb-div"></div>
          <div class="hb-row"><span class="hb-k">宇宙历</span><span class="hb-v text-gold">{{ universeDate }}</span></div>
          <div class="hb-time-row">
            <button @click="togglePause" class="holo-btn" :class="isPaused ? 'text-gold' : 'text-cyan'">
              <svg v-if="isPaused" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><polygon points="3,1 13,8 3,15"/></svg>
              <svg v-else viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><rect x="2" y="1" width="4" height="14"/><rect x="10" y="1" width="4" height="14"/></svg>
              {{ isPaused ? '推进' : '暂停' }}
            </button>
            <div class="hb-speed">
              <button v-for="sp in [0.5, 1, 2, 3]" :key="sp" @click="(store as any).strategicTimeSpeed = sp" class="holo-btn holo-btn-xs" :class="(store as any).strategicTimeSpeed === sp ? 'active-speed' : ''">x{{ sp }}</button>
            </div>
          </div>
          <div class="hb-div"></div>
          <div class="hb-actions">
            <button @click="showRoster = true" class="holo-icon" title="提督名册"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="4" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg></button>
            <button @click="showNetwork = true" class="holo-icon" title="提督关系网"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="3" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="13" cy="12" r="2"/><line x1="8" y1="5" x2="3" y2="10"/><line x1="8" y1="5" x2="13" y2="10"/><line x1="5" y1="12" x2="11" y2="12"/></svg></button>
            <button @click="$emit('open-save')" class="holo-icon" title="存档"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 15H3a1 1 0 01-1-1V2a1 1 0 011-1h8l3 3v10a1 1 0 01-1 1z"/><path d="M5 1v4h5V1"/><rect x="5" y="9" width="6" height="4" rx="0.5"/></svg></button>
            <button @click="showBrowser = true" class="holo-icon" title="银河百科"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z"/><line x1="8" y1="3.5" x2="8" y2="13.5"/></svg></button>
          </div>
        </div>
      </div>

      <!-- ===== 右下：小地图 + 俯视按钮（Three.js 渲染，常驻 DOM；锚点投影定位 + 自身 3D 立牌，随地图侧转） ===== -->
      <div ref="minimapRef" v-show="starmapMode === 'holo'" id="strategic-minimap" class="strategic-minimap holo-slot" :style="holoStyle('minimap')">
        <div class="mm-corner tl" id="mmTopBtn">⊥</div>
      </div>

      <div class="ui-layer">
      </div>

      <!-- 战术模拟浮动按钮（沙盒模式，非战役主流程） -->
      <button @click="openSimMode" class="sim-float-btn neo-btn" title="战术模拟 — 独立沙盒模式">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align: middle; margin-right: 4px;"><path d="M3 13l4-4"/><path d="M7 3l6 6-4 4-6-6 4-4z"/><path d="M9 5l2 2"/></svg>
        演训
      </button>

      <!-- 星球右键菜单 -->
      <div v-if="nodeMenu.visible" class="node-context-menu"
           :style="{ left: nodeMenu.x + 'px', top: nodeMenu.y + 'px' }" @click.stop>
        <div class="ncm-header">{{ menuNodeInfo?.name || '星域' }}</div>
        <div class="ncm-sub">类型：{{ menuNodeInfo?.type === 'capital' ? '首都' : menuNodeInfo?.type === 'fortress' ? '要塞' : menuNodeInfo?.type === 'resource' ? '资源' : '星域' }}
          · 驻留舰队 {{ (menuNodeInfo?.garrisonFleets || []).length }}</div>
        <div class="ncm-divider"></div>
        <div class="ncm-label">调派舰队（瓦普跃迁）</div>
        <div v-if="myFleetsForMenu.length === 0" class="ncm-empty">无空闲舰队可调派</div>
        <div v-for="f in myFleetsForMenu" :key="f.id" class="ncm-item" @click="dispatchWarp(f.id, nodeMenu.nodeId)">
          <span class="ncm-item-name">第{{ f.fleetNumber || '?' }}舰队</span>
          <span class="ncm-item-sub">司令 #{{ f.commanderId }}</span>
        </div>
        <div class="ncm-divider"></div>
        <div class="ncm-item ncm-close" @click="hideNodeMenu">关闭</div>
      </div>
    </div>

    <!-- 军务本部长 (提督+舰队+序列) -->
    <div v-if="currentTab === 'military'" class="tab-content panel-layer">
      <MilitaryHQPanel />
    </div>

    <!-- 军议院 (军议+行政) -->
    <div v-if="currentTab === 'council'" class="tab-content panel-layer">
      <CouncilAdminPanel />
    </div>

    <!-- 经济面板 -->
    <div v-if="currentTab === 'economy'" class="tab-content panel-layer">
      <EconomyPanel />
    </div>

    <!-- 军议会/行政院 overlay 面板（已并入军议院 tab 嵌入渲染） -->

    <!-- 战术模拟覆盖层（从星图浮动按钮触发） -->
    <div v-if="currentTab === 'sim'" class="tab-content panel-layer sim-overlay">
      <div class="sim-overlay-header">
        <button @click="switchTab('starmap')" class="neo-btn btn-sm text-slate-400">← 返回星图</button>
        <span class="sim-overlay-title">战术演训 — 独立沙盒模式</span>
      </div>
      <BattleSetupPanel />
    </div>

    <!-- 通讯面板（战后处置、舰队到达等） -->
    <CommsPanel />

    <!-- 事件选择对话框 -->
    <EventDialog
      v-if="(store as any).pendingEvent"
      :pending-event="(store as any).pendingEvent"
      @resolve="handleEventResolve"
    />

    <AdmiralNetworkPanel v-if="showNetwork" :faction="playerFaction" @close="showNetwork = false" />

    <!-- 提督名册浮层 -->
    <AdmiralRosterModal v-if="showRoster" @close="showRoster = false" />

    <!-- 银河百科浮层（全 242 条词条） -->
    <WikiBrowserModal v-if="showBrowser" @close="showBrowser = false" />

  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch, nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGameStore, getPortrait } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ThreeStrategicMap } from '../../game/three/ThreeStrategicMap';
import BattleSetupPanel from './BattleSetupPanel.vue';
import MilitaryHQPanel from './MilitaryHQPanel.vue';
import CouncilAdminPanel from './CouncilAdminPanel.vue';
import EconomyPanel from './EconomyPanel.vue';
import CommsPanel from './CommsPanel.vue';
import EventDialog from './EventDialog.vue';
import AdmiralNetworkPanel from './AdmiralNetworkPanel.vue';
import AdmiralRosterModal from './AdmiralRosterModal.vue';
import WikiBrowserModal from '../wiki/WikiBrowserModal.vue';
import { formatGold } from '../../utils/format';
const store = useGameStore();
const settings = useSettingsStore() as any;
const showNetwork = ref(false);
const showRoster = ref(false);
const showBrowser = ref(false);
// 兜底用的板屏幕坐标（板由引擎锚点投影驱动 left/top，这里存每帧回传的屏幕坐标与朝向）
// 新增 z（深度，离相机近值大 → 用于 3D 遮挡排序 zIndex）与 scale（随距离缩放比，用于放大保底可读）
const holoBoards = ref<Record<string, { x: number; y: number; rotX: number; rotY: number; visible: boolean; z?: number; scale?: number }>>({
  brie: { x: -999, y: -999, rotX: 0, rotY: 0, visible: false },
  radar: { x: -999, y: -999, rotX: 0, rotY: 0, visible: false },
  minimap: { x: -999, y: -999, rotX: 0, rotY: 0, visible: false },
  roster: { x: -999, y: -999, rotX: 0, rotY: 0, visible: false },
});

// 各角板在 CSS 里的固有（未缩放）尺寸，用于做视口边界约束与缩放基准
const HOLO_BASE_SIZE: Record<string, { w: number; h: number }> = {
  brie: { w: 200, h: 210 },
  radar: { w: 200, h: 190 },
  roster: { w: 200, h: 230 },
  minimap: { w: 220, h: 154 },
};
// 缩放范围：地图放大时框适度变大（保底可读），缩小不变过小。取 0.8~1.35。
const HOLO_SCALE_MIN = 0.8;
const HOLO_SCALE_MAX = 1.35;
const HOLO_VIEW_MARGIN = 12; // 屏幕四周留白（px）

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 生成角板的定位 + 3D 立牌 transform（引擎每帧投影回传 x/y/rotX/rotY + 新增 z/scale）
const holoStyle = (key: string): Record<string, string> => {
  const b = holoBoards.value[key];
  if (!b || !b.visible) {
    return { left: '-999px', top: '-999px', transform: 'none', pointerEvents: 'none' };
  }
  // —— 缩放：随相机距离适度放大/缩小（放大保底可读、缩小不锁死）——
  const scale = clampNum(b.scale ?? 1, HOLO_SCALE_MIN, HOLO_SCALE_MAX);
  // —— 视口边界约束（先约束位置，再看尺寸）：锚点为板底中心，板向上+向两侧延伸 ——
  // 用当前缩放后的固有尺寸估算板外扩范围，把 left/top clamp 在窗口内，保证地图放大/转动时框不飞出屏幕。
  const size = HOLO_BASE_SIZE[key] || HOLO_BASE_SIZE.brie;
  const halfW = (size.w * scale) / 2;
  const H = size.h * scale;
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = clampNum(b.x, HOLO_VIEW_MARGIN + halfW, vw - HOLO_VIEW_MARGIN - halfW);
  const top = clampNum(b.y, HOLO_VIEW_MARGIN + H, vh - HOLO_VIEW_MARGIN);
  // —— 深度遮挡：离相机近的板 z-index 更大（z 值来自引擎投影距离，距离近 → z 大）——
  // 映射到 40~58 带内：保证四块板之间做相对深度排序（近的盖远的），
  // 同时整体低于 nav(z-index:60) 与节点右键菜单(300)，避免反盖住顶部导航条（问题5 不能复发）。
  const zIndex = Math.round(clampNum(b.z ?? 50, 1, 200) * 0.09 + 40);
  return {
    left: left + 'px',
    top: top + 'px',
    zIndex: String(zIndex),
    // translate(-50%,-100%)：板底中心对齐锚点（板立在桌面支撑点上，而非悬空）；
    // scale(s)：随地图缩放适度放大/缩小（放在 rotate 之前、围绕锚点缩放，保证板不脱离锚点）；
    // rotateX(俯仰) rotateY(侧转)：板面法线(+Z)随相机视线转动 → 呈现"垂直托盘、随地图侧转"
    // perspective(1000px) 保持最外侧（leftmost=outermost），才能正确投影 rotateX/rotateY 的 3D 透视
    transform: `perspective(1000px) translate(-50%, -100%) scale(${scale.toFixed(3)}) rotateY(${b.rotY.toFixed(1)}deg) rotateX(${b.rotX.toFixed(1)}deg)`,
    pointerEvents: 'auto',
  };
};
// storeToRefs 保持 strategicPaused 的 ref 性质，避免 Pinia 解包后 toggle 失效
// store 类型推断不到这些字段，强制 any 解构
const { strategicPaused, userPaused } = storeToRefs(store as any) as any;
const emit = defineEmits(['open-save']);

// 玩家信息计算属性
const playerPortrait = computed(() => {
  const adm = (store as any).allAdmirals?.find((a: any) => a.id === (store as any).playerAdmiralId);
  return adm ? getPortrait(adm.imageId) : '';
});

const playerName = computed(() => {
  const adm = (store as any).allAdmirals?.find((a: any) => a.id === (store as any).playerAdmiralId);
  return adm ? adm.name : '未指派';
});

// 战略子面板切换
const currentTab = computed({
  get: () => { const r = (store as any).strategyTab; return r?.value !== undefined ? r.value : (r || 'starmap'); },
  set: (v: string) => { (store as any).strategyTab = v; }
});
const switchTab = (tab: string) => {
  currentTab.value = tab as any;
  // 离开战术模拟时清理 sim 状态
  if ((store as any).simMode) {
    if (typeof (store as any).exitSimMode === 'function') {
      (store as any).exitSimMode();
    }
  }
};

// 战术模拟浮动按钮：打开独立沙盒模式
const openSimMode = () => {
  if (typeof (store as any).enterSimMode === 'function') {
    (store as any).enterSimMode();
  }
  // 在星图上覆盖显示 BattleSetupPanel
  currentTab.value = 'sim' as any;
};

// 事件选择处理
const handleEventResolve = (choiceIndex: number | null) => {
  if (typeof (store as any).resolveEvent === 'function') {
    (store as any).resolveEvent(choiceIndex);
  }
};

// 对抗审查修复：切回星图 tab 后 Phaser canvas 需 resize 才能正确渲染
// 根因：v-show 隐藏时容器 clientWidth/clientHeight 归零，Phaser 自动缩至 0×0
// 切回后 CSS 恢复但 Phaser 不会自动感知尺寸变化 → 需要手动触发 resize
watch(currentTab, (newTab) => {
  if (newTab === 'starmap') {
    nextTick(() => {
      setTimeout(() => {
        if (threeMap) {
          threeMap.resize();
        }
      }, 80);
    });
  }
});

// 全局状态映射
const universeDate = computed(() => { const r = (store as any).universeDate; return r?.value !== undefined ? r.value : r; });
const playerMerit = computed(() => { const r = (store as any).playerMerit; return r?.value !== undefined ? r.value : r; });
const playerRank = computed(() => { const r = (store as any).playerRank; return r?.value !== undefined ? r.value : r; });
const safeFleets = computed(() => { const r = (store as any).strategicFleets; return r?.value !== undefined ? r.value : (r || []); });
// 使用 storeToRefs 拿到的 ref 直接读 .value，避免 Pinia 解包后再 toggle 的边角问题
const isPaused = computed(() => strategicPaused.value === true);

let threeMap: ThreeStrategicMap | null = null;

// ===== 战略星图显示模式（'universe' 宇宙无悬浮板 / 'holo' 悬浮板三维竖牌）=====
// 四角信息板 + 光柱由引擎锚点投影驱动；nav 顶部条固定常驻不随模式切换。
const starmapMode = computed<'universe' | 'holo'>({
  get: () => (settings.starmapDisplayMode === 'universe' ? 'universe' : 'holo'),
  set: (v) => { settings.starmapDisplayMode = v; },
});
// 板 DOM refs（v-show 常驻；引擎只锚点投影 4 块角板，nav 为屏幕顶部固定条不走这里）
const brieRef = ref<HTMLElement | null>(null);
const radarRef = ref<HTMLElement | null>(null);
const rosterRef = ref<HTMLElement | null>(null);
const minimapRef = ref<HTMLElement | null>(null);

const initStrategicEngine = () => {
  if (threeMap) {
    threeMap.destroy();
    threeMap = null;
  }
  
  const container = document.getElementById('strategic-canvas-container');
  if (!container) return;

  threeMap = new ThreeStrategicMap(container, store, {
    minimapEl: document.getElementById('strategic-minimap'),
    topViewBtnEl: document.getElementById('mmTopBtn'),
    // 宇宙模式关闭悬浮板（不建锚桩/光柱）
    enableHoloBoards: starmapMode.value === 'holo',
    onNodeClick: (nodeId) => {
      // 节点点击：后续阶段绑定信息面板
      console.log('[ThreeStarMap] node click', nodeId);
    },
    onFleetClick: (fleetId) => {
      console.log('[ThreeStarMap] fleet click', fleetId);
    },
    onNodeContextMenu: (nodeId, sx, sy) => {
      showNodeMenu(nodeId, sx, sy);
    },
    onHoloBoardAnchor: (key, screen) => {
      // 四角板：引擎每帧投影锚点到屏幕坐标 + 板面朝向，驱动 holoStyle 立牌定位
      const b = holoBoards.value[key];
      if (!b) return;
      b.x = screen.x; b.y = screen.y; b.visible = screen.visible;
      if (screen.rotX !== undefined) b.rotX = screen.rotX;
      if (screen.rotY !== undefined) b.rotY = screen.rotY;
      // 兼容新增字段：z（深度，离相机近值大 → zIndex 遮挡排序）、scale（随距离缩放比）
      if (screen.z !== undefined) b.z = screen.z;
      if (screen.scale !== undefined) b.scale = screen.scale;
    },
    // 暂停 → 引擎自动把相机回正到玩家视角，回正后叠加微浮动（板呈三维漂浮感）
    isStrategicPaused: () => strategicPaused.value === true,
  });
};

// ===== 星球右键菜单（Vue overlay）=====
const nodeMenu = ref<{ visible: boolean; x: number; y: number; nodeId: number }>({ visible: false, x: 0, y: 0, nodeId: 0 });
const showNodeMenu = (nodeId: number, sx: number, sy: number) => {
  nodeMenu.value = { visible: true, x: sx, y: sy, nodeId };
};
const hideNodeMenu = () => { nodeMenu.value.visible = false; };

const menuNodeInfo = computed(() => {
  const nodes = (store as any).strategicNodes?.value || (store as any).strategicNodes || [];
  return nodes.find((n: any) => n.id === nodeMenu.value.nodeId) || null;
});
// 玩家可调动的舰队（我方 + 空闲）
const myFleetsForMenu = computed(() => {
  const allFleets = (store as any).strategicFleets?.value || (store as any).strategicFleets || [];
  const adms = (store as any).allAdmirals?.value || (store as any).allAdmirals || [];
  const pAdm = adms.find((a: any) => a.id === (store as any).playerAdmiralId);
  const pFac = pAdm?.faction === 'alliance' ? 1 : pAdm?.faction === 'empire' ? 2 : 0;
  return allFleets.filter((f: any) => f.factionId === pFac && f.status === 'idle');
});
const dispatchWarp = (fleetId: number, targetNodeId: number) => {
  if (typeof (store as any).issueWarpOrder === 'function') {
    const result = (store as any).issueWarpOrder(fleetId, targetNodeId);
    if (result && result !== -1) {
      (store as any).triggerToast?.('舰队开始瓦普跃迁');
    } else {
      (store as any).triggerToast?.('无法派出：路径不可达或舰队忙');
    }
  }
  hideNodeMenu();
};

const handleResize = () => {
  if (threeMap) {
    threeMap.resize();
  }
};

let tickInterval: number;

onMounted(() => {
  if (typeof (store as any).initStrategicMap === 'function') {
    (store as any).initStrategicMap();
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('faction-scheme-changed', handleSchemeChange);
  setTimeout(() => initStrategicEngine(), 50);

  // tick 间隔 700ms：1倍速 = 7秒/天（10 tick × 700ms），节奏从容
  // 0.5倍速 = 14秒/天（精细操作），2倍速 = 3.5秒/天，3倍速 ≈ 2.3秒/天（快进）
  tickInterval = window.setInterval(() => {
    if (typeof (store as any).strategicTick === 'function') {
      (store as any).strategicTick();
    }
  }, 700);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('faction-scheme-changed', handleSchemeChange);
  if (tickInterval) {
    window.clearInterval(tickInterval);
    tickInterval = undefined as any;
  }
  if (threeMap) {
    threeMap.destroy();
    threeMap = null;
  }
});

// 势力配色方案切换 → 重建星图应用新配色
function handleSchemeChange() {
  initStrategicEngine();
}
// 战略星图显示模式切换（宇宙/悬浮板）→ 重建引擎应用新模式
watch(starmapMode, () => {
  initStrategicEngine();
});

const togglePause = () => {
  // 切换用户手动暂停标志
  userPaused.value = !userPaused.value;
  // 同步到 strategicPaused
  strategicPaused.value = userPaused.value;
};

// P2 军事/政略分流
const playerFaction = computed(() => {
  const adm = (store as any).allAdmirals?.find((a: any) => a.id === (store as any).playerAdmiralId);
  return adm?.faction || 'alliance';
});
// 阵营色 navbar：根据玩家阵营动态切换底色（同盟深蓝 / 帝国深红）
const factionNavClass = computed(() => playerFaction.value === 'alliance' ? 'faction-alliance' : 'faction-empire');

// ── 战局态势：双方总舰数与领土对比（让玩家感知大势）──
const warSituation = computed(() => {
  const playerFacId = playerFaction.value === 'alliance' ? 1 : 2;
  const enemyFacId = playerFacId === 1 ? 2 : 1;
  const fleets = safeFleets.value as any[];
  const nodesRaw = (store as any).strategicNodes;
  const nodes: any[] = nodesRaw?.value !== undefined ? nodesRaw.value : (nodesRaw || []);
  const countShips = (facId: number) => fleets
    .filter(f => f.factionId === facId)
    .reduce((s, f) => {
      const c = f.composition || {};
      return s + (c.battleships || 0) + (c.fastBattleships || 0) + (c.cruisers || 0) + (c.destroyers || 0) + (c.carriers || 0) + (c.fighters || 0);
    }, 0);
  const myShips = countShips(playerFacId);
  const enemyShips = countShips(enemyFacId);
  const myNodes = nodes.filter(n => n.ownerFactionId === playerFacId).length;
  const enemyNodes = nodes.filter(n => n.ownerFactionId === enemyFacId).length;
  const ratio = enemyShips > 0 ? (myShips / enemyShips) : (myShips > 0 ? 9.9 : 1);
  return {
    myShips, enemyShips, myNodes, enemyNodes,
    ratioLabel: ratio.toFixed(2),
    advantage: ratio >= 1.2 ? '优势' : ratio >= 0.8 ? '均势' : '劣势',
  };
});

// 警戒标签（由战局态势推导，不硬编码演示数据）
const alertLabel = computed(() => {
  return warSituation.value.advantage === '劣势' ? 'DEFCON 1' : warSituation.value.advantage === '优势' ? 'DEFCON 3' : 'DEFCON 2';
});
// 战略阶段标签（由战局态势推导，不硬编码演示数据）
const phaseLabel = computed(() => {
  return warSituation.value.advantage === '劣势' ? '防御' : warSituation.value.advantage === '优势' ? '进攻' : '对峙';
});
</script>

<style scoped>
.strategic-screen {
  position: relative; width: 100%; height: 100vh; overflow: hidden;
  background: var(--neo-body); display: flex; flex-direction: column;
  /* 顶部常驻条高度：随显示模式变化。面板内容区据此向下让位，避免被置顶菜单遮挡。
     默认 .nav-bar（单行，holo 等模式）≈52px；.universe-topbar（两行）≈104px。 */
  --topbar-h: 56px;
  text-align: center; /* v3：html 级居中已移除，此处补回顶栏/资源条的原有居中观感 */
}
/* 宇宙模式：顶部条为两行（交互行 + 数值行），更高 */
.strategic-screen.mode-universe { --topbar-h: 108px; }

/* =========================================
   面板内容区 — 去滚动条，仅列表内部滚动
   ========================================= */
.tab-content { flex: 1; position: relative; overflow: hidden; min-height: 0; min-width: 0; /* 修复：flex 子项缺横向收缩项，宽内容把容器撑破导致右侧溢出 */ }
.starmap-layer { position: relative; width: 100%; height: 100%; }
/* 面板内容区：顶部留出 --topbar-h 高位，让位于常驻置顶条（军事/军议院/经济/演训等面板不再被顶部菜单遮挡） */
.panel-layer { width: 100%; height: 100%; overflow: hidden; padding: calc(var(--topbar-h) + 12px) 12px 12px; }
.canvas-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
.ui-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: none; }

/* =========================================
   全息悬浮屏组（四角 HUD）— 位置随沙盘角落锚定、尺寸恒定、科幻斜切角
   ========================================= */
.holo-slot {
  position: absolute;
  z-index: 40;
  transform-origin: center center;
  will-change: left, top;
  transition: none;               /* 位置由 3D 投影逐帧驱动，禁用过渡防拖影 */
  pointer-events: none;
}
.holo-slot[style*="pointer-events"] {
  pointer-events: auto;           /* 可见时可交互 */
}

/* ===== 全息信息板主体：斜切能量边框 + 内发光 + 扫描线 ===== */
.holo-board {
  position: relative;
  width: 200px;
  padding: 12px 13px;
  color: var(--color-text-secondary);
  font-size: 12px;
  display: flex; flex-direction: column; gap: 6px;
  background:
    linear-gradient(160deg, rgba(8,16,28,0.86), rgba(5,10,20,0.78)),
    repeating-linear-gradient(0deg, rgba(45,212,191,0.03) 0 1px, transparent 1px 3px);
  border: 1px solid rgba(45,212,191,0.28);
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  box-shadow:
    0 0 22px rgba(0,0,0,0.55),
    inset 0 0 20px rgba(45,212,191,0.06),
    0 0 0 1px rgba(45,212,191,0.06);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}
/* 顶部能量条 */
.holo-board::before {
  content: '';
  position: absolute; top: 0; left: 12px; right: 0;
  height: 2px;
  background: linear-gradient(90deg, rgba(45,212,191,0.0), rgba(45,212,191,0.65), rgba(45,212,191,0.0));
}
/* 左下角能量刻点 */
.holo-board::after {
  content: '';
  position: absolute; left: 0; bottom: 0;
  width: 8px; height: 8px;
  border-left: 2px solid rgba(45,212,191,0.5);
  border-bottom: 2px solid rgba(45,212,191,0.5);
}

/* 头部标题 */
.hb-head {
  font-size: 12px; font-weight: 800; color: var(--color-cyan);
  border-bottom: 1px solid rgba(45,212,191,0.2);
  padding-bottom: 6px;
  display: flex; align-items: center; gap: 5px;
  letter-spacing: 1px;
}
/* 数据行 */
.hb-row { display: flex; justify-content: space-between; align-items: center; }
.hb-k { color: var(--color-text-disabled); font-size: 11px; }
.hb-v { font-weight: 700; color: var(--color-text-primary); font-size: 11px; }
.hb-log { font-size: 10px; color: var(--color-text-disabled); }
.hb-div { height: 1px; background: rgba(45,212,191,0.12); margin: 2px 0; }
.text-green { color: #22c55e; }
.text-red { color: #ef4444; }
.text-gold { color: #f59e0b; }

/* 迷你战力条 */
.hb-mini { display: flex; flex-direction: column; gap: 4px; }
.hb-mini-track { height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; }
.hb-mini-mine { height: 100%; background: linear-gradient(90deg, rgba(45,212,191,0.85), rgba(45,212,191,0.4)); border-radius: 4px; transition: width 0.4s; }
.hb-mini-label { font-size: 10px; color: var(--color-text-disabled); }

/* 指挥官面板（左下） */
.hb-player { display: flex; align-items: center; gap: 9px; }
.hb-avatar { width: 34px; height: 34px; border-radius: 4px; border: 1px solid var(--color-border-emphasized); object-fit: cover; }
.hb-player-detail { display: flex; flex-direction: column; line-height: 1.15; flex: 1; min-width: 0; }
.hb-rank { font-size: 10px; font-weight: 800; }
.hb-name { font-size: 13px; font-weight: 900; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hb-gold { font-size: 12px; font-weight: 900; font-family: monospace; white-space: nowrap; }
.hb-time-row { display: flex; align-items: center; gap: 6px; }
.hb-speed { display: flex; gap: 2px; flex: 1; }

/* 全息按钮 */
.holo-btn {
  flex: 1; padding: 4px 8px; font-size: 11px; font-weight: 800;
  background: rgba(6,182,212,0.08); border: 1px solid rgba(6,182,212,0.25);
  color: var(--color-text-secondary); border-radius: 4px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  white-space: nowrap; transition: all 0.15s;
}
.holo-btn:hover { border-color: var(--color-cyan); color: var(--color-cyan); background: rgba(6,182,212,0.16); }
.holo-btn.text-gold { color: #f59e0b; }
.holo-btn.text-cyan { color: #22d3ee; }
.holo-btn.active-speed { background: rgba(6,182,212,0.22); color: var(--color-cyan); border-color: var(--color-cyan); }
.holo-btn-xs { padding: 3px 5px; font-size: 10px; flex: 0 0 auto; }
.hb-actions { display: flex; gap: 5px; }
.holo-icon {
  flex: 1; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid rgba(6,182,212,0.2); border-radius: 4px;
  color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s;
}
.holo-icon:hover { border-color: var(--color-cyan); color: var(--color-cyan); background: rgba(6,182,212,0.08); }

/* 顶部导航条：屏幕固定顶部中央，两种显示模式都常驻、可点击 */
.nav-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  pointer-events: auto;
}

/* =========================================
   宇宙模式(universe)顶部长条信息框：
   合并原四角信息板 + 内含导航，常驻置顶，仅宇宙模式显示。
   整体与 .nav-bar 同风格（斜切边框+内发光），两行布局。
   ========================================= */
.universe-topbar {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(1000px, calc(100vw - 32px));
}
.universe-topbar.faction-empire .ut-tools,
.universe-topbar.faction-empire .holo-nav-group { border-color: rgba(248,113,113,0.3); }
.universe-topbar.faction-alliance .holo-nav-group { border-color: rgba(34,211,238,0.3); }

/* 两行共用面板底（全息斜切边框 + 内发光 + 扫描线，与 .holo-board 一致） */
.ut-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background:
    linear-gradient(160deg, rgba(8,16,28,0.86), rgba(5,10,20,0.78)),
    repeating-linear-gradient(0deg, rgba(45,212,191,0.03) 0 1px, transparent 1px 3px);
  border: 1px solid rgba(45,212,191,0.28);
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  box-shadow:
    0 0 22px rgba(0,0,0,0.55),
    inset 0 0 20px rgba(45,212,191,0.06),
    0 0 0 1px rgba(45,212,191,0.06);
  backdrop-filter: blur(8px);
}
/* 顶部能量条 */
.ut-row::before {
  content: '';
  position: absolute; top: 0; left: 12px; right: 0;
  height: 2px;
  background: linear-gradient(90deg, rgba(45,212,191,0.0), rgba(45,212,191,0.65), rgba(45,212,191,0.0));
}
/* 第2行数值：更紧凑，无能量条（由父级控制间隔） */
.ut-row-info { padding: 6px 14px; }
.ut-row-info::before { display: none; }

/* 行内分隔竖线 */
.ut-divider {
  width: 1px; height: 26px; align-self: center;
  background: linear-gradient(180deg, transparent, rgba(45,212,191,0.4), transparent);
  flex: 0 0 auto;
}

/* 军官信息（头像/军衔/姓名） */
.ut-officer { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.ut-avatar { width: 30px; height: 30px; border-radius: 4px; border: 1px solid var(--color-border-emphasized); object-fit: cover; }
.ut-officer-detail { display: flex; flex-direction: column; line-height: 1.1; }
.ut-rank { font-size: 10px; font-weight: 800; }
.ut-name { font-size: 13px; font-weight: 900; color: var(--color-text-primary); white-space: nowrap; }

/* 暂停/推进 + 倍速 */
.ut-time { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.ut-time-pause { flex: 0 0 auto; padding: 4px 10px; }
.ut-speed { display: flex; gap: 2px; }

/* 操作按钮组（名册/关系网/存档/演训） */
.ut-tools { display: flex; gap: 5px; flex: 0 0 auto; }

/* 第2行数值项：键+值紧凑排布 */
.ut-stat {
  display: inline-flex; align-items: baseline; gap: 5px;
  white-space: nowrap; font-size: 12px;
}
.ut-k { color: var(--color-text-disabled); font-size: 11px; font-weight: 600; }
.ut-v { font-weight: 800; color: var(--color-text-primary); font-size: 12px; font-family: monospace; }
.nav-bar.faction-empire .holo-nav-group { border-color: rgba(248,113,113,0.3); }
.nav-bar.faction-empire .holo-nav-group::before {
  content: ''; position: absolute; left: 10px; right: 0; top: 0; height: 2px;
  background: linear-gradient(90deg, rgba(248,113,113,0), rgba(248,113,113,0.65), rgba(248,113,113,0));
}
.nav-bar.faction-alliance .holo-nav-group { border-color: rgba(34,211,238,0.3); }
.holo-nav-group {
  display: flex; gap: 5px; padding: 5px 8px;
  background: linear-gradient(160deg, rgba(8,16,28,0.82), rgba(5,10,20,0.72));
  border: 1px solid rgba(45,212,191,0.24);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  box-shadow: 0 0 16px rgba(0,0,0,0.45), inset 0 0 14px rgba(45,212,191,0.05);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}
.holo-tab {
  padding: 5px 12px; font-size: 12px; font-weight: 800;
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  color: var(--color-text-secondary); cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
  transition: all 0.15s; position: relative;
}
.holo-tab:hover { color: var(--color-cyan); background: rgba(45,212,191,0.08); }
.holo-tab.active { color: var(--color-cyan); background: rgba(6,182,212,0.16); border-color: rgba(6,182,212,0.35); }
.holo-tab .tab-icon { font-size: 13px; }
.holo-tab .tab-text { font-size: 12px; }

/* 阵营色点缀（同盟青蓝 / 帝国深红） */
.badge-dot {
  position: absolute; top: -5px; right: -5px;
  min-width: 15px; height: 15px; padding: 0 3px;
  background: var(--color-empire); color: white; font-size: 10px; font-weight: 700;
  border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  margin-left: -2px;
}

/* ===== 小地图（3D 锚定在托盘右下，常驻 DOM） ===== */
.strategic-minimap {
  position: absolute; width: 220px; height: 154px;
  z-index: 50; border: 1px solid rgba(45,212,191,0.3);
  background: rgba(4,10,18,0.82); box-shadow: 0 0 18px rgba(0,255,136,0.1);
  cursor: crosshair; overflow: hidden;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}
.strategic-minimap canvas { width: 100%; height: 100%; display: block; }
.strategic-minimap .mm-corner {
  position: absolute; width: 16px; height: 16px; line-height: 16px; text-align: center;
  font-size: 11px; color: rgba(45,212,191,0.9); cursor: pointer; z-index: 21;
  font-family: monospace; user-select: none; border-radius: 2px;
}
.strategic-minimap .mm-corner:hover { background: rgba(45,212,191,0.2); }
.strategic-minimap .mm-corner.tl { top: 2px; left: 2px; }

/* 星球右键菜单 */
.node-context-menu {
  position: fixed; z-index: 300; width: 240px; border: 1px solid rgba(45, 212, 191, 0.5);
  background: rgba(4, 10, 18, 0.96); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(45, 212, 191, 0.15);
  border-radius: 8px; padding: 10px 0; font-family: inherit; cursor: default;
}
.node-context-menu .ncm-header {
  padding: 4px 14px 6px; font-size: 15px; font-weight: 900; color: #2dd4bf;
  border-left: 3px solid #2dd4bf; margin-left: 10px;
}
.node-context-menu .ncm-sub { padding: 0 14px 8px; font-size: 12px; color: #94a3b8; }
.node-context-menu .ncm-divider { height: 1px; background: rgba(45, 212, 191, 0.15); margin: 6px 10px; }
.node-context-menu .ncm-label { padding: 2px 14px 6px; font-size: 11px; color: #64748b; letter-spacing: 1px; }
.node-context-menu .ncm-empty { padding: 6px 14px; font-size: 12px; color: #64748b; font-style: italic; }
.node-context-menu .ncm-item {
  padding: 8px 14px; font-size: 13px; color: #e2e8f0; display: flex; justify-content: space-between;
  cursor: pointer; transition: background 0.15s;
}
.node-context-menu .ncm-item:hover { background: rgba(45, 212, 191, 0.12); color: #2dd4bf; }
.node-context-menu .ncm-item-name { font-weight: 700; }
.node-context-menu .ncm-item-sub { font-size: 11px; color: #64748b; }
.node-context-menu .ncm-close { color: #64748b; text-align: center; justify-content: center; font-weight: 600; }
.node-context-menu .ncm-close:hover { color: #f87171; background: rgba(248, 113, 113, 0.08); }

.left-panel {
  position: absolute; top: 20px; left: 15px; width: 220px; padding: 15px; pointer-events: auto;
}
.panel-title-small { font-size: 14px; font-weight: 900; border-left: 4px solid var(--color-cyan); padding-left: 8px; margin-bottom: 10px; }
.adm-item { padding: 8px 12px; margin-bottom: 8px; text-align: left; font-size: 13px; font-weight: 800; display: block; width: 100%; }

.bottom-controls {
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; padding: 10px 20px; pointer-events: auto;
}

@media (max-width: 1023px) {
  .panel-layer { padding: calc(var(--topbar-h) + 8px) 8px 8px; }
  .left-panel { width: 160px; top: 10px; left: 8px; padding: 10px; }
  .bottom-controls { bottom: 10px; padding: 6px 12px; gap: 6px; }
}

/* =========================================
   战术模拟浮动按钮 + 覆盖层
   ========================================= */
.sim-float-btn {
  position: absolute;
  bottom: 20px;
  left: 20px;
  z-index: 50;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 800;
  color: var(--color-purple, #a855f7);
  border: 1px solid rgba(168, 85, 247, 0.4);
  background: rgba(168, 85, 247, 0.1);
  border-radius: 8px;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.sim-float-btn:hover {
  background: rgba(168, 85, 247, 0.25);
  border-color: rgba(168, 85, 247, 0.8);
  box-shadow: 0 4px 20px rgba(168, 85, 247, 0.3);
  transform: translateY(-2px);
}

.sim-overlay {
  display: flex;
  flex-direction: column;
  gap: 0;
  /* 顶部让位于常驻置顶条，避免覆盖演训面板头部（含"返回星图"与一键选择舰队按钮） */
  padding: var(--topbar-h) 0 0;
  /* 置于全息板(40~58)之上，但低于顶部条(60)，确保置顶菜单始终可点、不被覆盖 */
  z-index: 59;
}
.sim-overlay-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: var(--neo-surface);
  border-bottom: 1px solid var(--overlay-border);
  flex-shrink: 0;
}
.sim-overlay-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--color-purple, #a855f7);
  letter-spacing: 1px;
}

/* 军议院 badge 位置修正 */
.nav-tab .badge-dot {
  position: relative;
  top: auto;
  right: auto;
  margin-left: 4px;
}

</style>