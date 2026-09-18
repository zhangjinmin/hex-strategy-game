<template>
  <div class="main-menu-container">
    <MenuSidebar @change-tab="menuTab = $event" :active-tab="menuTab" @open-save="showSaveModal = true" />
    <div class="content-area">
      <FleetHQPanel />
    </div>
    
    <SaveManagerModal v-if="showSaveModal" @close="showSaveModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore } from '../../store/gameStore';
import MenuSidebar from './MenuSidebar.vue';
import FleetHQPanel from './FleetHQPanel.vue';
import SaveManagerModal from './SaveManagerModal.vue';

const store = useGameStore();
const showSaveModal = ref(false);

const menuTab = computed({
  get: () => { const r = (store as any).menuTab; return r?.value !== undefined ? r.value : r; },
  set: (v) => { (store as any).menuTab = v; }
});
</script>

<style scoped>
.main-menu-container {
  width: 100%;
  height: 100vh;
  display: flex;
  background: var(--neo-body);
  overflow: hidden;
}

.content-area {
  flex: 1;
  margin-left: 160px;
  overflow: hidden;
}

@media (max-width: 768px) {
  .content-area { margin-left: 44px; }
}
</style>
