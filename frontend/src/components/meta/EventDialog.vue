<template>
  <div v-if="pendingEvent" class="event-overlay" @click.self="handleBackdropClick">
    <div class="event-dialog neo-card">
      <!-- 事件标题 -->
      <div class="event-header">
        <div class="event-icon" v-html="getEventIcon(pendingEvent.category)"></div>
        <div class="event-title-area">
          <h2 class="event-title">{{ pendingEvent.name }}</h2>
          <div class="event-category">{{ getCategoryName(pendingEvent.category) }}</div>
        </div>
      </div>

      <!-- 事件描述 -->
      <div class="event-body">
        <p class="event-description">{{ pendingEvent.description }}</p>
      </div>

      <!-- 选择按钮 -->
      <div class="event-choices">
        <button
          v-for="(choice, idx) in pendingEvent.choices"
          :key="idx"
          @click="makeChoice(idx)"
          class="neo-btn choice-btn"
          :class="getChoiceClass(choice)"
        >
          <div class="choice-text">{{ choice.text }}</div>
          <div class="choice-effect" v-if="choice.effectPreview">
            {{ choice.effectPreview }}
          </div>
        </button>
      </div>

      <!-- 跳过按钮（仅当所有选择都有代价时显示） -->
      <button
        v-if="canSkip"
        @click="skipEvent"
        class="neo-btn skip-btn text-slate-400"
      >
        暂不处理
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface EventChoice {
  text: string;
  effectPreview?: string;
  effect: () => void;
  type?: 'positive' | 'negative' | 'neutral';
}

interface PendingEvent {
  id: string;
  name: string;
  description: string;
  category: string;
  choices: EventChoice[];
  canSkip?: boolean;
}

const props = defineProps<{
  pendingEvent: PendingEvent | null;
}>();

const emit = defineEmits<{
  (e: 'resolve', choiceIndex: number | null): void;
}>();

const canSkip = computed(() => props.pendingEvent?.canSkip ?? false);

const getEventIcon = (category: string): string => {
  const icons: Record<string, string> = {
    political: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11"/></svg>',
    military: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px"><path d="M8 1L2 5v6l6 4 6-4V5L8 1z"/><line x1="8" y1="5" x2="8" y2="11"/></svg>',
    economic: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px"><circle cx="8" cy="8" r="6"/><path d="M8 4v8M5 7h6"/></svg>',
    social: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px"><circle cx="8" cy="5" r="3"/><path d="M3 14c0-3 2.2-5 5-5s5 2 5 5"/></svg>',
    scandal: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px"><circle cx="6.5" cy="6.5" r="4.5"/><line x1="10" y1="10" x2="14" y2="14"/></svg>',
  };
  return icons[category] || icons.economic;
};

const getCategoryName = (category: string): string => {
  const names: Record<string, string> = {
    political: '政治事件',
    military: '军事事件',
    economic: '财政事件',
    social: '社会事件',
    scandal: '丑闻事件',
  };
  return names[category] || '突发事件';
};

const getChoiceClass = (choice: EventChoice): string => {
  if (choice.type === 'positive') return 'choice-positive';
  if (choice.type === 'negative') return 'choice-negative';
  return 'choice-neutral';
};

const makeChoice = (idx: number) => {
  emit('resolve', idx);
};

const skipEvent = () => {
  emit('resolve', null);
};

const handleBackdropClick = () => {
  // 不允许点击背景关闭（必须做出选择）
  if (canSkip.value) {
    skipEvent();
  }
};
</script>

<style scoped>
.event-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.3s ease-out;
}

.event-dialog {
  width: min(600px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
  background: var(--neo-body);
  border: 2px solid var(--color-cyan);
  box-shadow: 0 0 40px rgba(0, 255, 255, 0.3);
  animation: slideUp 0.4s ease-out;
}

.event-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--overlay-border);
}

.event-icon {
  font-size: 48px;
  flex-shrink: 0;
}

.event-title-area {
  flex: 1;
}

.event-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0 0 4px 0;
}

.event-category {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.event-body {
  margin-bottom: 24px;
}

.event-description {
  font-size: 15px;
  line-height: 1.7;
  color: var(--color-text-primary);
  margin: 0;
}

.event-choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.choice-btn {
  padding: 16px;
  text-align: left;
  border: 2px solid var(--overlay-border);
  transition: all 0.2s;
}

.choice-btn:hover {
  border-color: var(--color-cyan);
  background: var(--overlay-hover);
  transform: translateX(4px);
}

.choice-text {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
}

.choice-effect {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.choice-positive .choice-text { color: var(--color-green); }
.choice-negative .choice-text { color: var(--color-red); }
.choice-neutral .choice-text { color: var(--color-cyan); }

.skip-btn {
  width: 100%;
  padding: 12px;
  font-size: 13px;
  border: 1px dashed var(--overlay-border);
}

.skip-btn:hover {
  border-color: var(--color-text-secondary);
  background: var(--overlay-surface);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 640px) {
  .event-dialog {
    padding: 16px;
  }

  .event-icon {
    font-size: 36px;
  }

  .event-title {
    font-size: 20px;
  }

  .choice-btn {
    padding: 12px;
  }
}
</style>
