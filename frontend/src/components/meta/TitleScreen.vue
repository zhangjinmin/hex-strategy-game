<template>
  <div class="title-screen ui-skin-front">
    <!-- 星空背景 -->
    <div class="starfield">
      <div v-for="i in 48" :key="'s'+i" class="star"
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
          <span class="btn-no">01</span>
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/><line x1="8" y1="0.5" x2="8" y2="2.5"/><line x1="8" y1="13.5" x2="8" y2="15.5"/><line x1="0.5" y1="8" x2="2.5" y2="8"/><line x1="13.5" y1="8" x2="15.5" y2="8"/></svg>
          </span>
          <span class="btn-label">新游戏</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">开启新的银河史诗</span>
        </button>

        <button class="title-btn" @click="openModal('continue')">
          <span class="btn-no">02</span>
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 3h4l1.5 1.5h6.5v9H2z"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="8" y1="9.5" x2="8" y2="12"/></svg>
          </span>
          <span class="btn-label">读取存档</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">继续未完成的征程</span>
        </button>

        <button class="title-btn" @click="enterSimMode">
          <span class="btn-no">03</span>
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><line x1="2" y1="3" x2="14" y2="3"/><line x1="4" y1="6" x2="12" y2="6"/><line x1="2" y1="9" x2="14" y2="9"/><line x1="4" y1="12" x2="12" y2="12"/></svg>
          </span>
          <span class="btn-label">战术模拟</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">会战推演 · 无需开局</span>
        </button>

        <button class="title-btn" @click="showBrowser = true">
          <span class="btn-no">04</span>
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 3.5C6.5 2.3 4.5 2 2 2v10c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z"/><line x1="8" y1="3.5" x2="8" y2="13.5"/></svg>
          </span>
          <span class="btn-label">银河百科</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">人物 · 组织 · 事件 · 科技</span>
        </button>

        <button class="title-btn" @click="openModal('settings')">
          <span class="btn-no">05</span>
          <span class="btn-icon">
            <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="4" width="14" height="9" rx="1"/><line x1="1" y1="7" x2="15" y2="7"/><circle cx="4" cy="10.5" r="0.8" fill="currentColor" stroke="none"/></svg>
          </span>
          <span class="btn-label">系统设置</span>
          <span class="btn-rule"></span>
          <span class="btn-desc">音频 · 战场 · 接口</span>
        </button>

        <button class="title-btn" @click="exitGame">
          <span class="btn-no">06</span>
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
/* ==================================================================
   标题界面 · 作品门面
   · 配色 / 中性令牌由根节点 .ui-skin-front 锁定（真源 design-system.css），
     不随 <html data-faction> 变化；本文件不重复抄任何颜色数值。
   · 展示字体交还设置项 uiFont（--dmc-font），本屏不再用阵营制式字形。
   ================================================================== */
.title-screen {
  --ui-display-font: var(--dmc-font);
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  background-color: var(--ui-bg);
  background-image:
    var(--ui-starmap),
    radial-gradient(ellipse at 50% 46%, transparent 24%, var(--ui-scrim) 100%);
}
.starfield { position: absolute; inset: 0; }
.star {
  position: absolute; background: var(--ui-ink); border-radius: 50%;
  opacity: 0.38; animation: twinkle 2.8s ease-in-out infinite alternate;
}
@keyframes twinkle { from { opacity: 0.10; } to { opacity: 0.52; } }

.title-container {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; text-align: center;
  width: min(920px, 86vw);
}
/* 顶部短轴 + 底部收束线：不再用两条贯穿全宽的长线夹住内容 */
.title-container::before {
  content: ''; width: 220px; height: 1px; margin-bottom: var(--ui-6);
  background: linear-gradient(to right, transparent, var(--ui-line-strong) 22%, var(--ui-accent) 50%, var(--ui-line-strong) 78%, transparent);
}
.title-container::after {
  content: ''; width: 120px; height: 1px; margin-top: var(--ui-6);
  background: linear-gradient(to right, transparent, var(--ui-line-strong), transparent);
}

/* logo 原生 1344×387，放到 148px 高仍低于原生分辨率，不会糊 */
.title-logo {
  height: clamp(104px, 14vh, 160px); width: auto; max-width: 88vw;
  margin-bottom: var(--ui-3); filter: saturate(0.92) contrast(1.02);
}
.title-subtitle {
  font-family: var(--ui-display-font); font-size: var(--fs-h2);
  font-weight: var(--ui-display-weight); letter-spacing: 0.14em;
  line-height: 1.3; color: var(--ui-ink-2); margin-bottom: var(--ui-8);
}

/* 菜单：无外框，只有行间细线；序号 / 图标 / 标签 / 引导线 / 描述 五段式。
   用对称 padding 而非 min-height：align-items:baseline 才能让标签与描述真正共基线，
   同时整行视觉上垂直居中（min-height + baseline 会让内容贴顶）。 */
.title-menu {
  display: flex; flex-direction: column;
  width: min(920px, 78vw);
  border-top: 1px solid var(--ui-line);
}
.title-btn {
  position: relative; display: flex; align-items: baseline; gap: var(--ui-3);
  width: 100%; padding: var(--ui-4);
  background: transparent; border: none;
  border-bottom: 1px solid var(--ui-line);
  cursor: pointer; text-align: left; color: var(--ui-ink);
  transition: background var(--ui-dur-micro) var(--ui-ease);
}
.title-btn::before {
  content: ''; position: absolute; left: 0; top: 14%; bottom: 14%; width: 2px;
  background: var(--ui-accent); opacity: 0;
  transition: opacity var(--ui-dur-micro) var(--ui-ease);
}
.title-btn:hover { background: var(--ui-accent-soft); }
.title-btn:hover::before { opacity: 1; }
.title-btn:hover .btn-icon,
.title-btn:hover .btn-no { color: var(--ui-accent); }
.title-btn:hover .btn-label { color: var(--ui-accent); }
.title-btn:hover .btn-desc { color: var(--ui-ink-2); }

.btn-no {
  align-self: center; flex: 0 0 26px;
  font-size: var(--fs-caption); font-weight: 800;
  font-variant-numeric: tabular-nums; letter-spacing: 0.08em;
  color: var(--ui-ink-3); transition: color var(--ui-dur-micro) var(--ui-ease);
}
.btn-icon {
  align-self: center; display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; color: var(--ui-ink-3);
  transition: color var(--ui-dur-micro) var(--ui-ease);
}
.btn-icon svg { width: 20px; height: 20px; }
.btn-label {
  font-family: var(--ui-display-font); font-size: var(--fs-h2);
  font-weight: var(--ui-display-weight); color: var(--ui-ink);
  letter-spacing: 0.06em; line-height: 1; white-space: nowrap;
  transition: color var(--ui-dur-micro) var(--ui-ease);
}
.btn-rule {
  align-self: center; flex: 1; height: 1px; min-width: 24px;
  background: var(--ui-line); margin: 0 var(--ui-2);
}
.btn-desc {
  flex: 0 0 220px; width: 220px; text-align: right;
  font-size: var(--fs-label); color: var(--ui-ink-3);
  letter-spacing: 0.04em; line-height: 1; white-space: nowrap;
  transition: color var(--ui-dur-micro) var(--ui-ease);
}

/* 设置外壳（沿用统一令牌；本屏随门面保持中立） */
.settings-overlay {
  position: fixed; inset: 0; z-index: 1200; background: var(--ui-scrim);
  display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px);
}
.settings-dialog {
  width: 640px; max-width: 95vw; max-height: 88vh; padding: var(--ui-5);
  display: flex; flex-direction: column; gap: var(--ui-3); overflow-y: auto;
  border: var(--ui-frame-strong); border-radius: var(--ui-radius);
  background: var(--ui-panel);
}
.flex-header { display: flex; justify-content: space-between; align-items: center; }
.m-0 { margin: 0; font-family: var(--ui-display-font); font-size: var(--fs-h2); font-weight: var(--ui-display-weight); letter-spacing: 0.1em; }
.px-3 { padding: 6px 12px; }
.settings-footer { display: flex; justify-content: space-between; gap: var(--ui-2); padding-top: var(--ui-2); border-top: var(--ui-frame); }
.btn-confirm { min-height: 42px; padding: 0 var(--ui-5); font-size: var(--fs-body); font-weight: 800; }
.outline { background: transparent; border: var(--ui-frame-strong); }

.text-gold { color: var(--dmc-warning); }
.text-emerald { color: var(--color-green) !important; }
.text-muted { color: var(--ui-ink-3); }
.text-red { color: var(--color-red, #ef4444); }
.w-full { width: 100%; }

@media (max-width: 900px) {
  .title-btn { gap: var(--ui-2); padding: var(--ui-3) var(--ui-2); }
  .btn-no { display: none; }
  .btn-desc { flex-basis: 170px; width: 170px; font-size: var(--fs-caption); }
}
@media (max-height: 820px) {
  .title-container::before { margin-bottom: var(--ui-3); }
  .title-container::after { margin-top: var(--ui-3); }
  .title-menu { width: min(720px, 78vw); }
  .title-logo { height: 96px; }
  .title-subtitle { margin-bottom: var(--ui-5); font-size: var(--fs-h3); }
  .title-btn { padding-top: var(--ui-2); padding-bottom: var(--ui-2); }
}
</style>
