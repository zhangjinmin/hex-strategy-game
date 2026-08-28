<template>
  <div class="wc-panel">
    <div class="wc-header">
      <span class="wc-title">⚔️ {{ factionName }}军部作战会议</span>
      <span class="wc-date">{{ universeDate }}</span>
    </div>

    <p class="wc-desc">军事提案由前线司令官提交，各舰队司令依据军阶权重表决。</p>

    <!-- 提案列表 -->
    <div class="proposal-list">
      <div v-for="(p, i) in militaryProposals" :key="i" class="proposal-card" @click="showVote(p)">
        <span class="tag-mil">{{ p.typeName }}</span>
        <strong>{{ p.title }}</strong>
        <p class="desc">{{ p.dialogue || p.description }}</p>
      </div>
      <div v-if="militaryProposals.length === 0" class="empty">— 暂无军事提案 —</div>
    </div>

    <!-- 表决弹层 -->
    <div v-if="voteProposal" class="overlay" @click.self="voteProposal = null">
      <div class="vote-card neo-card">
        <h3>提案表决：{{ voteProposal.title }}</h3>
        <p class="vote-desc">{{ voteProposal.description }}</p>
        <div class="vote-actions">
          <button @click="resolve(true)" class="neo-btn btn-sm text-cyan">赞成 (军部提案)</button>
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

const factionName = computed(() => {
  const adm = store.allAdmirals?.find((a: any) => a.id === store.playerAdmiralId);
  return adm?.faction === 'alliance' ? '同盟' : '帝国';
});

const universeDate = computed(() => store.universeDate || '—');

const militaryProposals = computed(() => {
  return (store.pendingProposals || []).filter((p: any) =>
    ['invasion', 'fleet_deploy', 'fortify', 'supply_line', 'personnel', 'tech_mobilize'].includes(p.type)
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
</script>

<style scoped>
.wc-panel { padding: 16px; }
.wc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.wc-title { font-size: 15px; font-weight: 800; color: var(--color-cyan); }
.wc-date { font-size: 11px; color: var(--color-text-disabled); }
.wc-desc { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 14px; }
.proposal-card { padding: 10px; border: 1px solid rgba(6,182,212,0.1); border-radius: 4px; cursor: pointer; margin-bottom: 8px; }
.proposal-card:hover { border-color: var(--color-cyan); }
.proposal-card strong { font-size: 13px; color: var(--color-text-primary); display: block; margin: 4px 0; }
.tag-mil { font-size: 10px; background: rgba(6,182,212,0.15); color: var(--color-cyan); padding: 1px 6px; border-radius: 3px; }
.desc { font-size: 11px; color: var(--color-text-secondary); margin: 0; }
.empty { padding: 20px; text-align: center; font-size: 12px; color: var(--color-text-disabled); }
.overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.vote-card { width: min(380px, 85vw); padding: 24px; text-align: center; }
.vote-card h3 { font-size: 15px; margin-bottom: 8px; }
.vote-desc { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 14px; }
.vote-actions { display: flex; justify-content: center; gap: 10px; }
</style>
