<template>
  <div class="ui-header">
    <div class="faction-infos">
      <div v-for="f in factionsList" :key="f.id" class="side-info neo-card" :class="{'inactive': !f.active}" v-show="f.type === 'player' || f.inVision">
        <img :src="getPortrait(f.imageId)" class="mini-portrait" @error="handleImgError" />
        <div class="info-content">
          <div class="faction-name" :class="{'text-player': f.type === 'player', 'text-ally': f.type === 'ai' && f.team === 1, 'text-red': f.team === 2}">
            [{{ f.team === 1 ? '我方' : '敌军' }}] {{ f.name }}
          </div>
          <div class="hp-bar-container">
            <div class="hp-bar-fill" :class="f.team === 1 ? 'bg-cyan' : 'bg-red'" :style="{ width: Math.max(0, f.hp) + '%' }"></div>
          </div>
          <div class="mini-gold" v-if="f.active">
            建制: <span class="text-cyan">{{ f.unitCount }}/{{ getShipLimit(f.rank) }}</span> | 军费: {{ Math.floor(f.gold) }}
          </div>
          <div class="mini-gold text-red" v-else>舰队已溃散</div>
        </div>
      </div>
    </div>
    <GameControls />
  </div>

  <div class="battle-dialog-overlay" :class="{'show': battleDialog.visible}">
    <img :src="getPortrait(battleDialog.imageId)" class="dialog-portrait" @error="handleImgError" />
    <div class="dialog-content neo-card">
      <div class="dialog-name text-gold">{{ battleDialog.name }}</div>
      <div class="dialog-text">{{ battleDialog.text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import GameControls from './GameControls.vue';

const store = useGameStore();

const battleDialog = computed(() => {
  const raw = (store as any).battleDialog;
  return raw?.value !== undefined ? raw.value : (raw || { imageId: '', name: '', text: '', visible: false });
});

const factionsList = computed<any[]>(() => {
  const raw = (store as any).factions;
  if (!raw) return [];
  const list = raw.value !== undefined ? raw.value : raw;
  return Array.isArray(list) ? list : [];
});

const getShipLimit = (rank: any) => {
  const r = Number(rank) || 1;
  if (typeof (store as any).getShipLimit === 'function') return (store as any).getShipLimit(r);
  return 4;
};

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40"><rect width="32" height="40" fill="%231e293b"/></svg>';
};
</script>

<style scoped>
.ui-header { position: absolute; top: 15px; left: 50%; transform: translateX(-50%); width: 96%; display: flex; justify-content: space-between; align-items: flex-start; z-index: 10; pointer-events: none; }
.faction-infos { display: flex; gap: 10px; flex-wrap: wrap; pointer-events: auto; max-width: 70%; }
.side-info { display: flex; gap: 10px; padding: 6px; align-items: center; background: var(--overlay-surface); backdrop-filter: blur(4px); transition: opacity 0.3s; }
.side-info.inactive { opacity: 0.4; filter: grayscale(1); }
.mini-portrait { width: 36px; height: 48px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0; }
.info-content { display: flex; flex-direction: column; width: 140px; }
.faction-name { font-size: 12px; font-weight: 900; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hp-bar-container { width: 100%; height: 4px; background: var(--color-border); border-radius: 2px; overflow: hidden; margin-bottom: 4px; }
.hp-bar-fill { height: 100%; transition: width 0.3s; }
.bg-cyan { background: var(--color-cyan); }
.bg-red { background: var(--color-empire); }
.mini-gold { color: var(--color-text-secondary); font-size: 11px; font-family: monospace; font-weight: 800; }
.text-cyan { color: var(--color-cyan); }

.battle-dialog-overlay { position: absolute; top: 100px; right: -400px; display: flex; align-items: flex-end; gap: 10px; z-index: 20; transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1); pointer-events: none; }
.battle-dialog-overlay.show { right: 20px; }
.dialog-portrait { width: 80px; height: 100px; object-fit: cover; border-radius: 4px; border: 2px solid var(--color-warning); box-shadow: 0 4px 15px rgba(0,0,0,0.5); background: var(--neo-surface); }
.dialog-content { padding: 12px 16px; min-width: 220px; max-width: 300px; background: var(--overlay-surface); backdrop-filter: blur(4px); border-left: 3px solid var(--color-warning); }
.dialog-name { font-size: 14px; font-weight: 900; margin-bottom: 6px; border-bottom: 1px solid var(--overlay-border); padding-bottom: 4px; }
.dialog-text { font-size: 13px; color: var(--color-text-primary); font-weight: 800; line-height: 1.4; }

@media (max-width: 768px) {
  .ui-header { flex-direction: column; gap: 10px; }
  .faction-infos { max-width: 100%; width: 100%; }
  .side-info { width: calc(50% - 5px); }
  .info-content { width: 100%; }
  .battle-dialog-overlay { top: auto; bottom: 80px; right: -100%; flex-direction: row-reverse; }
  .battle-dialog-overlay.show { right: 10px; }
}
</style>