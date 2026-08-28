<template>
  <div class="scenario-overlay" @click.self="$emit('cancel')">
    <div class="scenario-modal neo-card">
      <h3 class="text-gold mb-3">选择剧本</h3>
      <div class="scenario-grid">
        <div
          v-for="s in scenarios"
          :key="s.id"
          class="scenario-card"
          :class="{ selected: selectedId === s.id }"
          @click="selectedId = s.id"
        >
          <div class="scenario-year">宇宙历 {{ s.year }}</div>
          <div class="scenario-name">{{ s.name }}</div>
          <div class="scenario-desc">{{ s.description }}</div>
          <div class="scenario-meta">
            <span :class="'diff-' + s.difficulty">{{ diffLabel[s.difficulty] }}</span>
            <span class="faction-tag">{{ s.faction === 'both' ? '双阵营可选' : s.faction === 'empire' ? '帝国' : '同盟' }}</span>
          </div>
        </div>
      </div>
      <div class="scenario-actions">
        <button @click="$emit('cancel')" class="neo-btn btn-sm text-slate-400">返回</button>
        <button @click="selectedId && $emit('confirm', selectedId)" class="neo-btn btn-sm text-cyan" :disabled="!selectedId">确认选择</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { SCENARIOS, type ScenarioConfig } from '../../config/scenarioConfig';

const emit = defineEmits<{
  confirm: [scenarioId: string];
  cancel: [];
}>();

const scenarios = SCENARIOS;
const selectedId = ref<string | null>(null);
const diffLabel: Record<string, string> = { easy: '简单', normal: '标准', hard: '困难' };
</script>

<style scoped>
.scenario-overlay {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.scenario-modal {
  width: min(700px, 90vw); max-height: 80vh; overflow-y: auto;
  padding: 24px;
}
.scenario-grid { display: flex; gap: 12px; margin-bottom: 16px; }
.scenario-card {
  flex: 1; padding: 16px; border: 1px solid rgba(6,182,212,0.15); border-radius: 6px;
  cursor: pointer; transition: all 0.15s; background: rgba(0,0,0,0.2);
}
.scenario-card:hover, .scenario-card.selected { border-color: var(--color-cyan); background: rgba(6,182,212,0.06); }
.scenario-year { font-size: 13px; color: var(--color-cyan); font-weight: 700; margin-bottom: 6px; }
.scenario-name { font-size: 16px; font-weight: 800; color: var(--color-text-primary); margin-bottom: 8px; }
.scenario-desc { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; margin-bottom: 10px; }
.scenario-meta { display: flex; gap: 6px; font-size: 11px; }
.scenario-meta span { padding: 2px 8px; border-radius: 3px; font-weight: 600; }
.diff-easy { background: rgba(16,185,129,0.15); color: #10b981; }
.diff-normal { background: rgba(6,182,212,0.15); color: #06b6d4; }
.diff-hard { background: rgba(239,68,68,0.15); color: #ef4444; }
.faction-tag { background: rgba(148,163,184,0.1); color: #94a3b8; }
.scenario-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
