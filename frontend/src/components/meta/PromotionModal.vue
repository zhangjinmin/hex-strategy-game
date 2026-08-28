<template>
  <div class="promo-overlay" @click.self="$emit('close')">
    <div class="promo-modal neo-card">
      <div class="promo-rank-icon">{{ rankEmoji }}</div>
      <h3 class="promo-title text-gold">晋升仪式</h3>
      <div class="promo-admiral">{{ admiralName }}</div>
      <div class="promo-rank-change">
        <span class="old-rank">{{ oldRank }}</span>
        <span class="promo-arrow">→</span>
        <span class="new-rank text-cyan">{{ newRank }}</span>
      </div>
      <div class="promo-stats" v-if="statChanges.length > 0">
        <div v-for="s in statChanges" :key="s.name" class="promo-stat">
          <span>{{ s.name }}</span>
          <span class="text-green">+{{ s.value }}</span>
        </div>
      </div>
      <div class="promo-permissions">
        <div class="text-gold mb-1">新权限解锁：</div>
        <div v-for="p in newPermissions" :key="p" class="promo-perm">✓ {{ p }}</div>
      </div>
      <button @click="$emit('close')" class="neo-btn btn-sm text-cyan mt-3">接受任命</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  admiralName: string;
  oldRank: string;
  newRank: string;
  newPermissions: string[];
}>();

defineEmits<{ close: [] }>();

const rankLevels = ['准尉','少尉','中尉','大尉','少校','中校','上校','准将','少将','中将','上将','一级上将','元帅'];
const rankEmoji = computed(() => {
  const idx = rankLevels.indexOf(props.newRank);
  return idx >= 10 ? '🌟' : idx >= 8 ? '⭐' : '🎖️';
});

const statChanges = computed(() => {
  const oldIdx = rankLevels.indexOf(props.oldRank);
  const newIdx = rankLevels.indexOf(props.newRank);
  const diff = newIdx - oldIdx;
  if (diff <= 0) return [];
  return [
    { name: '统帅', value: diff },
    { name: '运营', value: Math.floor(diff * 0.5) },
  ].filter(s => s.value > 0);
});
</script>

<style scoped>
.promo-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; }
.promo-modal { width: min(380px, 85vw); padding: 28px; text-align: center; }
.promo-rank-icon { font-size: 40px; margin-bottom: 8px; }
.promo-title { font-size: 16px; font-weight: 800; margin-bottom: 6px; }
.promo-admiral { font-size: 18px; font-weight: 800; color: var(--color-text-primary); margin-bottom: 10px; }
.promo-rank-change { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 14px; }
.old-rank { font-size: 15px; color: var(--color-text-disabled); }
.promo-arrow { font-size: 18px; color: var(--color-gold); }
.new-rank { font-size: 18px; font-weight: 800; }
.promo-stats { display: flex; justify-content: center; gap: 16px; margin-bottom: 14px; }
.promo-stat { font-size: 13px; color: var(--color-text-secondary); display: flex; flex-direction: column; align-items: center; gap: 2px; }
.promo-permissions { font-size: 12px; color: var(--color-text-secondary); text-align: left; margin: 0 auto; max-width: 250px; }
.promo-perm { padding: 1px 0; }
.text-green { color: #10b981; font-weight: 700; }
</style>
