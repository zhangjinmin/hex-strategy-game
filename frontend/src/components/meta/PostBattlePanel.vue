<template>
  <div class="selection-modal">
    <div class="modal-content neo-card" style="width: 480px; max-width: 94vw;">
      <h3 class="text-gold mb-3">
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-3px;margin-right:6px;"><path d="M8 1L2 5v6l6 4 6-4V5L8 1z"/><line x1="8" y1="5" x2="8" y2="11"/></svg>
        战后处置
      </h3>

      <div class="battle-summary mb-4">
        <p class="text-sm text-muted">
          {{ nodeName }} 的战火已经平息。你的舰队控制了该星域。
          <template v-if="result">
            <br/>击沉 {{ result.defenderLosses }} 舰 · 损失 {{ result.attackerLosses }} 舰
          </template>
        </p>
      </div>

      <div class="action-grid">
        <button class="action-btn neo-btn" @click="handleAction('occupy')">
          <div class="action-icon"><svg viewBox="0 0 20 20" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M10 1L3 7v10l7 4 7-4V7L10 1z"/><rect x="7" y="9" width="6" height="8" rx="0.5"/></svg></div>
          <div class="action-name">占 领</div>
          <div class="action-desc">纳入领土，治理星球<br/>治安 -15，忠诚 +10</div>
        </button>

        <button class="action-btn neo-btn" @click="handleAction('pillage')">
          <div class="action-icon"><svg viewBox="0 0 20 20" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="10" cy="10" r="8"/><circle cx="10" cy="10" r="3"/><line x1="10" y1="2" x2="10" y2="7"/><line x1="10" y1="13" x2="10" y2="18"/><line x1="2" y1="10" x2="7" y2="10"/><line x1="13" y1="10" x2="18" y2="10"/></svg></div>
          <div class="action-name">掠 夺</div>
          <div class="action-desc">一次性获取 +1500 金币<br/>星球荒废，士气 -10</div>
        </button>

        <button class="action-btn neo-btn" @click="handleAction('liberate')">
          <div class="action-icon"><svg viewBox="0 0 20 20" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 4c-1.5 2-2 5-2 7 0 1 .5 2 1 3M4 7c0 0 2-1 4 1s4 2 6 0c0 0 2-2 2-4"/><path d="M10 2v18"/></svg></div>
          <div class="action-name">解 放</div>
          <div class="action-desc">归还给原势力<br/>行政功勋 +150，外交改善</div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGameStore } from '../../store/gameStore';
import { PostBattleActionType } from '../../types/game';

const emit = defineEmits<{ (e: 'resolve', action: string): void }>();
const store = useGameStore();

const ctx = (store as any).pendingPostBattle || {};
const nodeId = ctx.nodeId;
const result = ctx.result;
const nodeName = nodeId != null
  ? ((store as any).strategicNodes?.value || []).find((n: any) => n.id === nodeId)?.name || '未知星域'
  : '未知星域';

const handleAction = (action: string) => {
  emit('resolve', action);
};
</script>

<style scoped>
.battle-summary { background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid var(--overlay-border); }
.action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.action-btn {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 16px 10px; text-align: center; cursor: pointer;
  border: 1px solid var(--overlay-hover); transition: all 0.2s;
}
.action-btn:hover { border-color: var(--color-cyan); background: rgba(6,182,212,0.05); }
.action-icon svg { display: block; margin: 0 auto; color: var(--color-cyan); }
.action-name { font-size: 15px; font-weight: 900; letter-spacing: 2px; }
.action-desc { font-size: 10px; color: var(--color-text-disabled); line-height: 1.4; }
</style>
