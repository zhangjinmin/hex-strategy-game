<template>
  <div class="fp-overlay" @click.self="$emit('decline')">
    <div class="fp-modal neo-card">
      <div class="fp-icon">⚠️</div>
      <h3 class="text-warning mb-2">提案被否决</h3>
      <p class="fp-desc">{{ proposalTitle }}未获多数支持。</p>
      <p class="fp-detail" v-if="playerPP >= 1000">
        你有 <span class="text-cyan">{{ playerPP }}</span> 政治工作值。
        消耗 <span class="text-gold">1000</span> 强行通过此提案？
      </p>
      <p class="fp-detail text-slate-400" v-else>
        政治工作值不足（需要1000，当前{{ playerPP }}），无法强行通过。
      </p>
      <div class="fp-actions">
        <button @click="$emit('decline')" class="neo-btn btn-sm text-slate-400">接受结果</button>
        <button v-if="playerPP >= 1000" @click="$emit('force')" class="neo-btn btn-sm text-amber">强行通过 (1000 PP)</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ proposalTitle: string; playerPP: number }>();
defineEmits<{ force: []; decline: [] }>();
</script>

<style scoped>
.fp-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
.fp-modal { width: min(400px, 85vw); padding: 24px; text-align: center; }
.fp-icon { font-size: 32px; margin-bottom: 8px; }
.fp-desc { font-size: 14px; color: var(--color-text-primary); margin-bottom: 8px; }
.fp-detail { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 12px; }
.fp-actions { display: flex; justify-content: center; gap: 10px; }
</style>
