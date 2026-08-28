<template>
  <div v-if="visible" class="confirm-overlay" @click.self="handleCancel">
    <div class="confirm-card">
      <!-- 顶部 accent 条 -->
      <div class="accent-bar"></div>

      <!-- 标题 -->
      <div class="confirm-header">
        <span class="confirm-title">{{ title }}</span>
        <button @click="handleCancel" class="neo-btn abort-btn">✕</button>
      </div>

      <!-- 消息内容 -->
      <div class="confirm-body">
        <p class="confirm-message">{{ message }}</p>
      </div>

      <!-- 消耗金额高亮 -->
      <div class="cost-row">
        <span class="cost-label">消耗</span>
        <span class="cost-value">₮ {{ formatNum(cost) }}</span>
      </div>

      <!-- 按钮区 -->
      <div class="confirm-actions">
        <button @click="handleConfirm" class="neo-btn btn-confirm">确认执行</button>
        <button @click="handleCancel" class="neo-btn">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../../store/gameStore';

const gameStore = useGameStore();

const visible = computed(() => {
  const pc = (gameStore as any).pendingConfirm;
  return pc?.value !== undefined ? !!pc.value : !!pc;
});

const title = computed(() => {
  const pc = (gameStore as any).pendingConfirm;
  const val = pc?.value !== undefined ? pc.value : pc;
  return val?.title || '';
});

const message = computed(() => {
  const pc = (gameStore as any).pendingConfirm;
  const val = pc?.value !== undefined ? pc.value : pc;
  return val?.message || '';
});

const cost = computed(() => {
  const pc = (gameStore as any).pendingConfirm;
  const val = pc?.value !== undefined ? pc.value : pc;
  return val?.cost || 0;
});

const handleConfirm = () => {
  (gameStore as any).resolveConfirm(true);
};

const handleCancel = () => {
  (gameStore as any).resolveConfirm(false);
};

const formatNum = (n: number): string => {
  if (n === undefined || n === null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString();
};
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.confirm-card {
  background: var(--neo-body);
  border: 1px solid var(--overlay-hover);
  border-radius: 12px;
  width: 360px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.accent-bar {
  height: 4px;
  background: var(--color-warning);
  flex-shrink: 0;
}

.confirm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px 8px;
}

.confirm-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--color-text-primary);
  letter-spacing: 0.05em;
}

.abort-btn {
  color: var(--color-empire);
  font-size: 14px;
  font-weight: 800;
  padding: 4px 8px;
  line-height: 1;
}

.confirm-body {
  padding: 0 20px 12px;
}

.confirm-message {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.cost-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  margin: 0 16px 8px;
  background: var(--color-overlay-pressed);
  border-radius: 8px;
}

.cost-label {
  font-size: 12px;
  color: var(--color-text-disabled);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.cost-value {
  font-size: 20px;
  font-weight: 900;
  font-family: monospace;
  color: var(--color-warning);
}

.confirm-actions {
  display: flex;
  gap: 8px;
  padding: 0 20px 20px;
}

.btn-confirm {
  color: var(--color-green);
  border-color: var(--color-green);
  font-weight: 800;
  flex: 1;
}

.btn-confirm:hover {
  background: var(--color-green);
  color: var(--neo-body);
}
</style>
