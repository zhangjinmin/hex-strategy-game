<template>
  <div class="sidebar-mask" v-if="!isSidebarCollapsed && isMobile" @click="closeSidebar"></div>

  <div class="sidebar neo-card" :class="{ 'collapsed': isSidebarCollapsed }">
    <div class="sidebar-header">
      <img src="../../assets/pic/logo.png" alt="LOGH" class="logo-img" />
      <button class="collapse-btn" @click="toggleSidebar">≡</button>
    </div>
    
    <div class="resource-panel" v-if="!isSidebarCollapsed">
      <div class="res-item text-gold" title="军费">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="8" cy="8" r="7"/><path d="M8 2v12M3 4l10 3M3 12l10-3" stroke="var(--neo-body)" stroke-width="1.5"/></svg>
        <span class="val">{{ metaGold }}</span>
      </div>
      <div class="res-item text-cyan" title="战术功勋">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><polygon points="8,1 10,6 15,6 11,9 13,14 8,11 3,14 5,9 1,6 6,6"/></svg>
        <span class="val">{{ tacticalMerit }}</span>
      </div>
      <div class="res-item text-emerald" title="行政功勋">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="1" width="10" height="14" rx="1"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="8" x2="10" y2="8"/><line x1="6" y1="11" x2="8" y2="11"/></svg>
        <span class="val">{{ adminMerit }}</span>
      </div>
    </div>

    <nav class="nav-menu">
      <button @click="handleNavClick('battle')" class="neo-btn nav-btn" :class="{active: activeTab === 'battle'}">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1L2 5v6l6 4 6-4V5L8 1z"/><path d="M8 5v6"/><path d="M5 7l3 2 3-2"/></svg>
        <span class="text" v-if="!isSidebarCollapsed">舰队编成</span>
      </button>
      <div class="divider"></div>
    </nav>

    <div class="sidebar-footer" v-if="!isSidebarCollapsed">
      <button @click="(store as any).gameState = 'strategy'" class="neo-btn outline text-emerald footer-btn" title="星图">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/><path d="M8 2v1M8 13v1M2 8h1M13 8h1"/></svg> 星图
      </button>
      <button @click="store.openEditorMode()" class="neo-btn outline text-cyan footer-btn" title="编辑">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 12h12M2 4h6M2 8h10"/></svg> 编辑
      </button>
      <button @click="handleActionClick('save')" class="neo-btn outline text-gold footer-btn" title="存档">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="4" width="14" height="9" rx="1"/><line x1="1" y1="7" x2="15" y2="7"/><circle cx="4" cy="10.5" r="0.8" fill="currentColor"/></svg> 存档
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../../store/gameStore';

const props = defineProps<{ activeTab: string }>();
const emit = defineEmits(['change-tab', 'open-save']);
const store = useGameStore();
const isSidebarCollapsed = computed(() => (store as any).isSidebarCollapsed);
const isMobile = computed(() => window.innerWidth <= 768);
const metaGold = computed(() => (store as any).metaGold?.toFixed?.(0) ?? 0);
const tacticalMerit = computed(() => (store as any).tacticalMerit ?? 0);
const adminMerit = computed(() => (store as any).adminMerit ?? 0);

function toggleSidebar() { (store as any).isSidebarCollapsed = !(store as any).isSidebarCollapsed; }
function closeSidebar() { (store as any).isSidebarCollapsed = true; }
function handleNavClick(tab: string) { emit('change-tab', tab); closeSidebar(); }
function handleActionClick(action: string) { if (action === 'save') emit('open-save'); }
</script>

<style scoped>
.sidebar-mask { position: fixed; inset: 0; z-index: 800; background: rgba(0,0,0,0.4); }
.sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 160px; z-index: 801; display: flex; flex-direction: column; padding: 0; border-radius: 0; border-right: 1px solid var(--color-border); }
.sidebar.collapsed { width: 44px; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--color-border); }
.logo-img { height: 22px; }
.collapse-btn { background: none; border: none; color: var(--color-text-disabled); font-size: 16px; cursor: pointer; }

.resource-panel { padding: 6px 10px; border-bottom: 1px solid var(--color-border); }
.res-item { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
.res-item .val { font-weight: 800; }

.nav-menu { flex: 1; padding: 6px 8px; }
.nav-btn { display: flex; align-items: center; gap: 8px; padding: 8px 6px; width: 100%; border: none; background: transparent; color: var(--color-text-secondary); font-size: 12px; cursor: pointer; text-align: left; border-radius: 4px; }
.nav-btn:hover, .nav-btn.active { color: var(--color-cyan); background: rgba(6,182,212,0.06); }
.divider { height: 1px; background: var(--color-border); margin: 4px 0; }

.sidebar-footer { padding: 6px 8px; border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 4px; }
.footer-btn { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 4px 6px; }
</style>
