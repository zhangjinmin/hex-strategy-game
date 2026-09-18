<template>
  <div class="title-screen">
    <!-- 星空背景 -->
    <div class="starfield">
      <div v-for="i in 80" :key="'s'+i" class="star"
        :style="{
          left: Math.random() * 100 + '%',
          top: Math.random() * 100 + '%',
          animationDelay: Math.random() * 3 + 's',
          width: (Math.random() * 3 + 1) + 'px',
          height: (Math.random() * 3 + 1) + 'px',
        }"
      />
    </div>

    <div class="title-container">
      <img src="../../assets/pic/logo.png" alt="LOGH" class="title-logo" />
      <div class="title-subtitle">银河英雄传说 · 星际战略版</div>

      <div class="title-menu">
        <button class="title-btn" @click="startNewGame">
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><line x1="8" y1="0.5" x2="8" y2="2.5"/><line x1="8" y1="13.5" x2="8" y2="15.5"/><line x1="0.5" y1="8" x2="2.5" y2="8"/><line x1="13.5" y1="8" x2="15.5" y2="8"/></svg>
          </span>
          <span class="btn-label">新游戏</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">开启新的银河史诗</span>
        </button>

        <button class="title-btn" @click="openModal('continue')">
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 3h4l1.5 1.5h6.5v9H2z"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="8" y1="9.5" x2="8" y2="12"/></svg>
          </span>
          <span class="btn-label">读取存档</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">继续未完成的征程</span>
        </button>

        <button class="title-btn" @click="enterSimMode">
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><line x1="2" y1="3" x2="14" y2="3"/><line x1="4" y1="6" x2="12" y2="6"/><line x1="2" y1="9" x2="14" y2="9"/><line x1="4" y1="12" x2="12" y2="12"/></svg>
          </span>
          <span class="btn-label">战术模拟</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">会战推演 · 无需开局</span>
        </button>

        <button class="title-btn" @click="showBrowser = true">
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z"/><line x1="8" y1="3.5" x2="8" y2="13.5"/></svg>
          </span>
          <span class="btn-label">银河百科</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">人物 · 组织 · 事件 · 科技</span>
        </button>

        <button class="title-btn" @click="openModal('settings')">
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="4" width="14" height="9" rx="1"/><line x1="1" y1="7" x2="15" y2="7"/><circle cx="4" cy="10.5" r="0.8" fill="currentColor" stroke="none"/></svg>
          </span>
          <span class="btn-label">系统设置</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">音频 · 战场 · 接口</span>
        </button>

        <button class="title-btn" @click="exitGame">
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
          </span>
          <span class="btn-label">退出</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">结束本场征途</span>
        </button>
      </div>
    </div>

    <!-- 统一入口：存档 / 系统设置都走「战术电脑」（SaveManagerModal），由 initial-tab 定位 -->
    <SaveManagerModal v-if="showModal" :initial-tab="modalTab" @close="showModal = false" />

    <!-- 银河百科（全 242 条词条，无需开局即可查阅） -->
    <WikiBrowserModal v-if="showBrowser" @close="showBrowser = false" />

    <!-- 剧本选择 -->
    <ScenarioSelectModal v-if="showScenarioSelect" @confirm="onScenarioConfirm" @cancel="onScenarioCancel" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useGameStore } from '../../store/gameStore';
import ScenarioSelectModal from './ScenarioSelectModal.vue';
import SaveManagerModal from './SaveManagerModal.vue';
import WikiBrowserModal from '../wiki/WikiBrowserModal.vue';

const store = useGameStore() as any;
const showModal = ref(false);
const modalTab = ref<'new' | 'continue' | 'manage' | 'settings'>('continue');
const showScenarioSelect = ref(false);
const showBrowser = ref(false);

const startNewGame = () => { showScenarioSelect.value = true; };
const onScenarioConfirm = (id: string) => { showScenarioSelect.value = false; (store as any).selectedScenarioId = id; store.showAdmiralSelect = true; store.gameState = 'title'; };
const onScenarioCancel = () => { showScenarioSelect.value = false; };
const openModal = (tab: 'new' | 'continue' | 'manage' | 'settings') => { modalTab.value = tab; showModal.value = true; };
const enterSimMode = () => { if (typeof store.enterSimMode === 'function') store.enterSimMode(); store.gameState = 'sim'; };
const exitGame = () => { window.close(); };
</script>

<style scoped>
.title-screen {
  position: fixed; inset: 0;
  background: radial-gradient(ellipse at center, var(--neo-body) 0%, var(--neo-body) 70%);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; z-index: 1000;
}
.starfield { position: absolute; inset: 0; }
.star {
  position: absolute; background: var(--color-text-primary);
  border-radius: 50%;
  animation: twinkle 2s ease-in-out infinite alternate;
}
@keyframes twinkle { from { opacity: 0.2; } to { opacity: 0.8; } }

.title-container { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; z-index: 1; }
.title-logo { height: 64px; width: auto; margin-bottom: 8px; }
.title-subtitle { font-size: 16px; color: var(--color-text-disabled); letter-spacing: 3px; margin-bottom: 28px; }

.title-menu { display: flex; flex-direction: column; gap: 1px; width: 440px; max-width: 94vw; background: var(--overlay-hover); border: 1px solid var(--overlay-hover); border-radius: 4px; overflow: hidden; }
.title-btn {
  display: flex; align-items: center; gap: 16px;
  width: 100%; padding: 22px 26px;
  background: var(--neo-body); border: none;
  cursor: pointer; text-align: left; transition: background 0.15s;
  position: relative;
}
.title-btn:hover { background: rgba(192, 200, 220, 0.06); }
.title-btn:hover .btn-icon { color: var(--color-text-primary); }
.title-btn:hover .btn-label { color: var(--color-text-primary); letter-spacing: 5px; }
.title-btn:hover .btn-desc { opacity: 1; }
.btn-icon { display: flex; align-items: center; width: 24px; color: var(--color-text-disabled); transition: color 0.2s; }
.btn-label { font-size: 18px; font-weight: 700; color: var(--color-text-secondary); letter-spacing: 3px; transition: letter-spacing 0.2s, color 0.2s; white-space: nowrap; }
.btn-rule { flex: 1; height: 1px; background: var(--overlay-hover); margin: 0 6px; }
.btn-desc { font-size: 13px; color: var(--color-text-disabled); opacity: 0.55; white-space: nowrap; letter-spacing: 1px; transition: opacity 0.2s; }

/* 设置外壳（设置面板内容在 SettingsPanel 内部 scoped 样式中） */
.settings-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: var(--overlay-scrim);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px);
}
.settings-dialog {
  width: 560px; max-width: 95vw; max-height: 88vh;
  padding: 24px; display: flex; flex-direction: column; gap: 16px;
  overflow-y: auto;
}
.flex-header { display: flex; justify-content: space-between; align-items: center; }
.m-0 { margin: 0; font-size: 20px; font-weight: 900; }
.px-3 { padding: 6px 12px; }

.settings-footer { display: flex; justify-content: space-between; gap: 10px; padding-top: 12px; border-top: 1px solid var(--overlay-hover); }
.btn-confirm { padding: 10px 28px; font-size: 14px; font-weight: 800; }
.outline { background: transparent; border: 1px solid rgba(255,255,255,0.15); }

.text-gold { color: var(--color-warning); }
.text-emerald { color: var(--color-green) !important; }
.text-muted { color: var(--color-text-disabled); }
.text-red { color: var(--color-red, #ef4444); }
.w-full { width: 100%; }
</style>
