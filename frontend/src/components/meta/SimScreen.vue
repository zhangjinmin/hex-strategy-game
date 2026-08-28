<template>
  <div class="sim-screen">
    <div class="sim-header">
      <button class="back-btn neo-btn text-slate-400" @click="exitSim">← 返回主菜单</button>
      <div class="sim-title">战术模拟 · 会战推演</div>
    </div>
    <div class="sim-body">
      <BattleSetupPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import BattleSetupPanel from './BattleSetupPanel.vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore() as any;

const exitSim = () => {
  if (typeof store.exitSimMode === 'function') store.exitSimMode();
  store.gameState = 'title';
};
</script>

<style scoped>
.sim-screen {
  position: fixed; inset: 0;
  background: var(--neo-body);
  display: flex; flex-direction: column;
  z-index: 1000;
}
.sim-header {
  display: flex; align-items: center; gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--overlay-hover);
  background: var(--overlay-surface);
  flex-shrink: 0;
}
.sim-title {
  font-size: 14px; font-weight: 800; color: var(--color-text-secondary);
  letter-spacing: 2px;
}
.sim-body {
  flex: 1; overflow: hidden; padding: 8px;
}
</style>
