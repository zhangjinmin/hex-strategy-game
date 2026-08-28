<template>
  <div class="pc-panel">
    <div class="pc-header">
      <span class="pc-title">{{ isEmpire ? '🏰 帝国宰相府' : '🏛️ 最高评议会' }}</span>
      <span class="pc-date">{{ universeDate }}</span>
    </div>

    <p class="pc-desc">
      {{ isEmpire ? '帝国宰相府统辖帝国全境政务。旧贵族仍有残余影响力。' : '最高评议会是同盟最高权力机构。文官政府节制军队。' }}
    </p>

    <!-- 玩家政治地位 -->
    <div class="status-card">
      <div class="status-row">
        <span>操作者</span>
        <span class="text-cyan">{{ playerAdmiral?.name }}</span>
      </div>
      <div class="status-row">
        <span>政治工作值</span>
        <span class="text-gold">{{ playerPP }}</span>
      </div>
      <div class="status-row" v-if="playerPP >= 8000">
        <span></span>
        <button @click="attemptCoup" class="neo-btn btn-sm text-red">发动政变 (8000PP)</button>
      </div>
    </div>

    <!-- 政略提案列表 -->
    <div class="proposal-list">
      <div v-for="(p, i) in politicalProposals" :key="i" class="proposal-card" @click="showVote(p)">
        <span class="tag-pol">{{ p.typeName }}</span>
        <strong>{{ p.title }}</strong>
        <p class="desc">{{ p.dialogue || p.description }}</p>
      </div>
      <div v-if="politicalProposals.length === 0" class="empty">— 暂无政略提案 —</div>
    </div>

    <!-- 表决 -->
    <div v-if="voteProposal" class="overlay" @click.self="voteProposal = null">
      <div class="vote-card neo-card">
        <h3>{{ isEmpire ? '御前会议' : '评议会表决' }}：{{ voteProposal.title }}</h3>
        <p class="vote-desc">{{ voteProposal.description }}</p>
        <div class="vote-actions">
          <button @click="resolve(true)" class="neo-btn btn-sm text-cyan">赞成</button>
          <button @click="resolve(false)" class="neo-btn btn-sm text-red">否决</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore() as any;
const voteProposal = ref<any>(null);

const playerAdmiral = computed(() => store.allAdmirals?.find((a: any) => a.id === store.playerAdmiralId));
const isEmpire = computed(() => playerAdmiral.value?.faction === 'empire');
const playerPP = computed(() => playerAdmiral.value?.politicalWork || 0);
const universeDate = computed(() => store.universeDate || '—');

const politicalProposals = computed(() => {
  return (store.pendingProposals || []).filter((p: any) =>
    ['tax', 'budget', 'planet_op', 'personnel', 'diplomat', 'welfare'].includes(p.type)
  );
});

function showVote(p: any) { voteProposal.value = p; }
function resolve(approved: boolean) {
  if (voteProposal.value) {
    const idx = store.pendingProposals.findIndex((pp: any) => pp.id === voteProposal.value.id);
    if (idx >= 0 && store.resolveProposal) store.resolveProposal(idx, approved);
  }
  voteProposal.value = null;
}
function attemptCoup() {
  const result = store.attemptCoup?.();
  if (result) store.triggerToast(result.message);
}
</script>

<style scoped>
.pc-panel { padding: 16px; }
.pc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.pc-title { font-size: 15px; font-weight: 800; color: var(--color-gold); }
.pc-date { font-size: 11px; color: var(--color-text-disabled); }
.pc-desc { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 12px; }
.status-card { padding: 10px; border: 1px solid rgba(245,158,11,0.1); border-radius: 4px; margin-bottom: 14px; }
.status-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
.proposal-card { padding: 10px; border: 1px solid rgba(245,158,11,0.1); border-radius: 4px; cursor: pointer; margin-bottom: 8px; }
.proposal-card:hover { border-color: var(--color-gold); }
.proposal-card strong { font-size: 13px; color: var(--color-text-primary); display: block; margin: 4px 0; }
.tag-pol { font-size: 10px; background: rgba(245,158,11,0.15); color: var(--color-gold); padding: 1px 6px; border-radius: 3px; }
.desc { font-size: 11px; color: var(--color-text-secondary); margin: 0; }
.empty { padding: 20px; text-align: center; font-size: 12px; color: var(--color-text-disabled); }
.overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.vote-card { width: min(380px, 85vw); padding: 24px; text-align: center; }
.vote-card h3 { font-size: 15px; margin-bottom: 8px; }
.vote-desc { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 14px; }
.vote-actions { display: flex; justify-content: center; gap: 10px; }
</style>
