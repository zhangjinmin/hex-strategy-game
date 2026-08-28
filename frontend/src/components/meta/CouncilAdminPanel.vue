<template>
  <div class="council-admin-panel">
    <div class="hq-subnav">
      <button @click="activeTab = 'war'" class="hq-tab-btn" :class="{ active: activeTab === 'war' }">
        <span class="hq-tab-icon">⚔️</span>
        <span class="hq-tab-label">军事会议</span>
      </button>
      <button @click="activeTab = 'political'" class="hq-tab-btn" :class="{ active: activeTab === 'political' }">
        <span class="hq-tab-icon">🏛️</span>
        <span class="hq-tab-label">{{ politicalTabLabel }}</span>
      </button>
      <button @click="activeTab = 'admin'" class="hq-tab-btn" :class="{ active: activeTab === 'admin' }">
        <span class="hq-tab-icon">📋</span>
        <span class="hq-tab-label">行政</span>
      </button>
    </div>

    <div class="hq-content">
      <WarCouncilPanel v-if="activeTab === 'war'" />
      <PoliticalCouncilPanel v-else-if="activeTab === 'political'" />
      <AdminPanel v-else-if="activeTab === 'admin'" embedded />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import WarCouncilPanel from './WarCouncilPanel.vue';
import PoliticalCouncilPanel from './PoliticalCouncilPanel.vue';
import AdminPanel from './AdminPanel.vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore() as any;
const activeTab = ref('war');

const politicalTabLabel = computed(() => {
  const adm = store.allAdmirals?.find((a: any) => a.id === store.playerAdmiralId);
  return adm?.faction === 'empire' ? '宰相府' : '评议会';
});
</script>

<style scoped>
.council-admin-panel { height: 100%; display: flex; flex-direction: column; }
.hq-subnav { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); }
.hq-tab-btn { display: flex; align-items: center; gap: 4px; padding: 6px 12px; border: none; background: transparent; color: var(--color-text-disabled); font-size: 12px; cursor: pointer; border-radius: 4px; transition: all 0.15s; }
.hq-tab-btn:hover { color: var(--color-text-primary); background: rgba(6,182,212,0.05); }
.hq-tab-btn.active { color: var(--color-cyan); background: rgba(6,182,212,0.1); }
.hq-tab-icon { font-size: 14px; }
.hq-content { flex: 1; overflow-y: auto; }
</style>
