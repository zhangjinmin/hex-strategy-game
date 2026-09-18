<template>
  <div class="we-overlay" @click.self="close">
    <div class="we-modal neo-card">
      <div class="we-header">
        <div class="we-crumb">
          <button v-if="stack.length > 1" class="we-back" title="返回上一词条" @click="back">‹ 返回</button>
          <span class="we-crumb-text">{{ currentTitle }}</span>
        </div>
        <button class="neo-btn text-slate-400 px-2" @click="close">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="2" y1="2" x2="14" y2="14" />
            <line x1="14" y1="2" x2="2" y2="14" />
          </svg>
        </button>
      </div>

      <div class="we-body">
        <WikiEntryView :entry-key="stack[stack.length - 1] || ''" mode="full" open-mode="first" @open-entry="push" />
      </div>

      <div v-if="stack.length > 1" class="we-trail">
        <span class="we-trail-label">路径</span>
        <span v-for="(k, i) in stack" :key="i" class="we-trail-item">
          <span v-if="i > 0" class="we-trail-sep">›</span>
          <span class="we-trail-key" :class="{ active: i === stack.length - 1 }" @click="jumpTo(i)">{{ k }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import WikiEntryView from './WikiEntryView.vue';

const props = defineProps<{ entryKey: string }>();
const emit = defineEmits<{ close: [] }>();

const stack = ref<string[]>([]);

watch(
  () => props.entryKey,
  (k) => {
    stack.value = k ? [k] : [];
  },
  { immediate: true }
);

const currentTitle = computed(() => stack.value[stack.value.length - 1] || '词条');

const push = (key: string) => {
  if (!key || key === stack.value[stack.value.length - 1]) return;
  // 环状跳转保护：已出现过的词条不再压栈，改为回退到该层
  const seen = stack.value.indexOf(key);
  if (seen >= 0) stack.value = stack.value.slice(0, seen + 1);
  else stack.value = [...stack.value, key];
};

const back = () => {
  if (stack.value.length > 1) stack.value = stack.value.slice(0, -1);
};

const jumpTo = (i: number) => {
  stack.value = stack.value.slice(0, i + 1);
};

const close = () => emit('close');
</script>

<style scoped>
.we-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: var(--overlay-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
}
.we-modal {
  width: 76vw;
  max-width: 980px;
  height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
}
.we-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.we-crumb {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.we-back {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-cyan);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--duration-fast) var(--ease-out);
}
.we-back:hover { background: rgba(52, 152, 219, 0.12); }
.we-crumb-text {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.we-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 6px;
}
.we-trail {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
  padding-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 10px;
}
.we-trail-label {
  color: var(--color-text-disabled);
  font-weight: 800;
  letter-spacing: 0.08em;
  margin-right: 4px;
}
.we-trail-item { display: inline-flex; align-items: center; gap: 4px; }
.we-trail-sep { color: var(--color-text-disabled); }
.we-trail-key {
  color: var(--color-text-secondary);
  cursor: pointer;
  border-bottom: 1px dashed transparent;
}
.we-trail-key:hover { color: var(--color-cyan); border-bottom-color: var(--color-cyan); }
.we-trail-key.active { color: var(--dmc-gold); cursor: default; border-bottom-color: transparent; }
</style>
