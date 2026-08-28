<template>
  <div class="battle-log" v-if="entries.length > 0">
    <div
      v-for="(e, i) in entries"
      :key="i"
      class="log-entry"
      :class="e.type"
      @animationend="removeEntry(i)"
    >
      {{ e.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface LogEntry {
  text: string;
  type: 'kill' | 'ability' | 'damage' | 'info';
}

const entries = ref<LogEntry[]>([]);
const MAX_ENTRIES = 8;

function removeEntry(i: number) {
  entries.value.splice(i, 1);
}

function addLogEntry(entry: LogEntry) {
  entries.value.push(entry);
  if (entries.value.length > MAX_ENTRIES) {
    entries.value.shift();
  }
  // 自动清理（每条显示4秒后淡出）
  setTimeout(() => {
    const idx = entries.value.indexOf(entry);
    if (idx >= 0) entries.value.splice(idx, 1);
  }, 4000);
}

defineExpose({ addLogEntry });
</script>

<style scoped>
.battle-log {
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column-reverse; gap: 3px;
  z-index: 1200; pointer-events: none; max-width: 600px;
}
.log-entry {
  font-size: 11px; font-weight: 600; padding: 3px 12px;
  background: rgba(0,0,0,0.7); border-radius: 4px;
  animation: logFadeIn 0.3s ease-out;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.log-entry.kill { color: #f59e0b; }
.log-entry.ability { color: #06b6d4; }
.log-entry.damage { color: #ef4444; }
.log-entry.info { color: #94a3b8; }

@keyframes logFadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
