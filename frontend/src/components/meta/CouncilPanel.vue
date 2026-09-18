<template>
  <div v-if="(gameStore as any).showCouncilPanel" class="council-panel open">
    <!-- ===== 面板头部 ===== -->
    <div class="panel-header">
      <div class="header-title">
        <span class="pulse-dot"></span>
        <span>{{ panelTitle }}</span>
      </div>
      <div class="header-date">{{ (gameStore as any).universeDate || '—' }}</div>
      <button @click="closePanel" class="neo-btn abort-btn">✕</button>
    </div>

    <!-- ===== 面板主体（可滚动） ===== -->
    <div class="panel-body">
      <!-- 操作者档案 + 政治生态（紧凑布局） -->
      <div class="section operator-section">
        <div class="section-label">授权操作者</div>
        <div class="card player-card">
          <img :src="playerPortrait" class="player-portrait" />
          <div class="player-info">
            <div class="player-name">{{ playerAdmiral?.name || '—' }}</div>
            <div class="player-role">{{ playerRoleName }} · {{ playerRankName }}</div>
            <div class="player-vote">
              <span class="vote-label">票权</span>
              <span class="vote-value">{{ playerAdmiral?.rank || 0 }}</span>
            </div>
            <div class="vote-bar">
              <div class="vote-fill" :style="{ width: weightedPct + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- 政治生态 -->
        <div class="section-header" style="margin-top: 10px;">
          <span class="section-label">政治生态</span>
          <span class="section-meta">权重 {{ totalCouncilWeight }}</span>
        </div>
        <div class="card">
          <div class="stance-bar">
            <div class="stance-hawk" :style="{ width: (stanceWeights.hawk / stanceWeights.total * 100) + '%' }"></div>
            <div class="stance-neutral" :style="{ width: (stanceWeights.neutral / stanceWeights.total * 100) + '%' }"></div>
            <div class="stance-cons" :style="{ width: (stanceWeights.cons / stanceWeights.total * 100) + '%' }"></div>
          </div>
          <div class="member-list">
            <div v-for="member in councilMembers.slice(0, 4)" :key="member.id" class="member-row">
              <div class="member-left">
                <img :src="getPortrait(member.imageId)" class="member-avatar" />
                <span class="member-name">{{ member.name }}</span>
              </div>
              <div class="member-right">
                <span class="member-rank">{{ member.rank }}</span>
                <span class="member-stance" :class="getPoliticalStance(member).css">{{ getPoliticalStance(member).label }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 待处理提案 -->
      <div class="section pending-section">
        <div class="section-header">
          <span class="section-label">待处理提案 ({{ councilPendingCount }})</span>
        </div>
        <div class="proposal-list">
          <div
            v-for="(prop, idx) in filteredProposals"
            :key="idx"
            class="proposal-card"
            @click="selectProposal(prop, idx)"
          >
            <div class="proposal-tag" :class="getProposalTagClass(prop.type)">
              {{ getProposalName(prop.type) }}
            </div>
            <h4 class="proposal-title">{{ getProposalDef(prop.type)?.name }}</h4>
            <p class="proposal-desc">{{ getProposalDef(prop.type)?.description }}</p>
            <p v-if="prop.dialogue" class="proposal-dialogue">{{ prop.dialogue }}</p>
            <span class="proposal-risk">⚠ {{ getProposalDef(prop.type)?.risk }}</span>
          </div>
          <div v-if="filteredProposals.length === 0" class="empty-state">
            — 本月暂无待审提案 —
          </div>
        </div>
      </div>

      <!-- 历史决议 -->
      <div class="section history-section">
        <div class="section-label">历史决议 ({{ filteredHistory.length }})</div>
        <div class="history-list">
          <div
            v-for="(item, idx) in filteredHistory"
            :key="idx"
            class="history-item"
            :class="item.status"
          >
            <span class="history-name">{{ getProposalName(item.type) }}</span>
            <span class="history-status" :class="item.status">
              {{ item.status === 'approved' ? '通过' : item.status === 'player_rejected' ? '否决' : '否决' }}
            </span>
            <span class="history-date">{{ item.resolvedDate || '—' }}</span>
          </div>
          <!-- 唱票明细（最近一次表决的提督分票） -->
          <div v-if="latestVoteBreakdown.length > 0" class="vote-breakdown">
            <div class="section-label" style="margin-top: 6px;">唱票明细</div>
            <div
              v-for="(vb, vIdx) in latestVoteBreakdown"
              :key="vIdx"
              class="vote-row"
            >
              <span class="vote-name" :class="{ 'vote-name-self': vb.isProposer }">{{ vb.name }}</span>
              <span class="vote-stance" :class="vb.support ? 'vote-yes' : 'vote-no'">
                {{ vb.support ? '赞成' : '反对' }}
              </span>
              <span class="vote-weight">{{ vb.weight }}分</span>
            </div>
          </div>
          <div v-if="councilHistory.length === 0" class="empty-state">
            — 暂无历史记录 —
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 详情确认卡（弹出层） ===== -->
    <div v-if="selectedProposal" class="proposal-detail-overlay" @click.self="selectedProposal = null">
      <div class="proposal-detail-card">
        <div class="detail-header">
          <div class="proposal-tag" :class="getProposalTagClass(selectedProposal.type)">
            {{ getProposalName(selectedProposal.type) }}
          </div>
          <button @click="selectedProposal = null" class="neo-btn abort-btn">✕</button>
        </div>
        <h3 class="detail-title">{{ getProposalDef(selectedProposal.type)?.name }}</h3>
        <p class="detail-desc">{{ getProposalDef(selectedProposal.type)?.description }}</p>
        <p v-if="selectedProposal.dialogue" class="proposal-dialogue">{{ selectedProposal.dialogue }}</p>

        <div class="detail-row">
          <span class="detail-label">效果:</span>
          <span class="detail-value">{{ getProposalDef(selectedProposal.type)?.effect }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">风险:</span>
          <span class="detail-value">{{ getProposalDef(selectedProposal.type)?.risk }}</span>
        </div>
        <div class="detail-row" v-if="getProposalDef(selectedProposal.type)?.rejectionEffect">
          <span class="detail-label">否决后果:</span>
          <span class="detail-value detail-warn">{{ getProposalDef(selectedProposal.type)?.rejectionEffect }}</span>
        </div>

        <div class="detail-actions">
          <button @click="confirmProposal" class="neo-btn btn-confirm">提交表决</button>
          <button @click="rejectProposal" class="neo-btn btn-reject">否决</button>
          <button @click="selectedProposal = null" class="neo-btn">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import { getPoliticalStanceLabel } from '../../config/tagConfig';
import { PROPOSAL_DEFINITIONS } from '../../utils/proposalEngine';
import type { ProposalType } from '../../types/game';

const gameStore = useGameStore();

// ─── 响应式状态 ───
const selectedProposal = ref<any>(null);

// ─── 从 store 读取数据 ───
const pendingProposals = computed<any[]>(() => (gameStore as any).pendingProposals || []);
const councilHistory = computed<any[]>(() => (gameStore as any).councilHistory || []);
const councilPendingCount = computed(() => (gameStore as any).councilPendingCount || 0);
const councilMode = computed<'military' | 'political'>(() => (gameStore as any).councilMode || 'military');

// P2: 军事提案类型 vs 政略提案类型
const MILITARY_TYPES = ['invasion', 'defense', 'conscription', 'morale_boost', 'fortify'];
const POLITICAL_TYPES = ['budget', 'personnel'];

const filteredProposals = computed(() => {
  const mode = councilMode.value;
  const filter = mode === 'military' ? MILITARY_TYPES : POLITICAL_TYPES;
  return pendingProposals.value.filter((p: any) => filter.includes(p.type));
});

const filteredHistory = computed(() => {
  const mode = councilMode.value;
  const filter = mode === 'military' ? MILITARY_TYPES : POLITICAL_TYPES;
  return councilHistory.value.filter((h: any) => filter.includes(h.type));
});

// 唱票明细：最近一条带 voteBreakdown 的历史决议（当前分流下）
const latestVoteBreakdown = computed<{ name: string; support: boolean; weight: number; isProposer: boolean }[]>(() => {
  const latest = filteredHistory.value.find((h: any) => Array.isArray(h.voteBreakdown) && h.voteBreakdown.length > 0);
  if (!latest) return [];
  return (latest.voteBreakdown as any[]).map((vb: any) => ({
    name: String(vb.name || ''),
    support: !!vb.support,
    weight: Number(vb.weight || 0),
    isProposer: String(vb.name || '').includes('提案人'),
  }));
});

const panelTitle = computed(() => {
  if (councilMode.value === 'military') return '统合作战本部';
  const adm = ((gameStore as any).allAdmirals || []).find((a: any) => a.id === (gameStore as any).playerAdmiralId);
  return adm?.faction === 'empire' ? '帝国宰相府' : '最高评议会';
});

// ─── 玩家信息 ───
const playerAdmiral = computed(() =>
  ((gameStore as any).allAdmirals || []).find((a: any) => a.id === (gameStore as any).playerAdmiralId) || null
);
const playerFaction = computed(() => playerAdmiral.value?.faction || 'empire');
const playerPortrait = computed(() =>
  playerAdmiral.value ? getPortrait(playerAdmiral.value.imageId) : ''
);
const playerRankName = computed(() => playerAdmiral.value?.rankName || '平民');

const roleDict: Record<string, string> = {
  emperor: '帝国皇帝', prime_minister: '帝国宰相', military_minister: '军务尚书',
  high_command_chief: '统帅本部总长', space_fleet_commander: '宇宙舰队司令',
  space_fleet_deputy: '舰队副司令', council: '评议会议长', joint_ops_chief: '统合本部长',
  joint_ops_deputy: '统合本部次长', fleet_commander: '舰队司令官', defense_commander: '防卫司令官',
  intel_minister: '情报部长', fleet_staff: '舰队参谋', none: '无职务'
};
const playerRoleName = computed(() => roleDict[playerAdmiral.value?.role || 'none'] || '无职务');

// ─── 议会成员与政治生态 ───
const councilMembers = computed(() => {
  if (!playerAdmiral.value) return [];
  return ((gameStore as any).allAdmirals || [])
    .filter((a: any) => a.faction === playerFaction.value && a.rank >= 8 && a.id !== playerAdmiral.value.id)
    .sort((a: any, b: any) => b.rank - a.rank);
});

const totalCouncilWeight = computed(() =>
  councilMembers.value.reduce((sum: number, adm: any) => sum + adm.rank, 0)
);

const weightedPct = computed(() => {
  const rank = playerAdmiral.value?.rank || 0;
  const total = totalCouncilWeight.value + rank;
  return total > 0 ? (rank / total) * 100 : 0;
});

const getPoliticalStance = (admiral: any) => {
  return getPoliticalStanceLabel(admiral.tags || []);
};

const stanceWeights = computed(() => {
  let hawk = 0, cons = 0, neutral = 0;
  councilMembers.value.forEach((m: any) => {
    const stance = getPoliticalStance(m).label;
    if (stance === '主战') hawk += m.rank;
    else if (stance === '保守') cons += m.rank;
    else neutral += m.rank;
  });
  const total = hawk + cons + neutral || 1;
  return { hawk, cons, neutral, total };
});

// ─── 提案定义辅助函数 ───
const getProposalDef = (type: string) => PROPOSAL_DEFINITIONS[type as ProposalType];
const getProposalName = (type: string) => getProposalDef(type)?.name || type;
const getProposalTagClass = (type: string) => `prop-tag-${type}`;

// ─── 操作函数 ───
const selectProposal = (prop: any, idx: number) => {
  selectedProposal.value = { ...prop, idx };
};

const confirmProposal = () => {
  if (!selectedProposal.value) return;
  const idx = selectedProposal.value.idx;
  (gameStore as any).resolveProposal(idx, true);
  selectedProposal.value = null;
};

const rejectProposal = () => {
  if (!selectedProposal.value) return;
  const idx = selectedProposal.value.idx;
  (gameStore as any).resolveProposal(idx, false);
  selectedProposal.value = null;
};

const closePanel = () => {
  (gameStore as any).showCouncilPanel = false;
};
</script>

<style scoped>
/* ===== 侧滑面板容器 ===== */
.council-panel {
  position: fixed;
  right: 0;
  top: 50px;          /* navbar 下沿起始，不遮挡导航栏 */
  height: calc(100vh - 50px);
  width: 480px;
  z-index: 90;
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  background: var(--neo-body);
  border-left: 1px solid var(--color-border);
  box-shadow: -8px 0 24px var(--color-shadow);
  font-family: "Nunito", -apple-system, sans-serif;
}
.council-panel.open {
  transform: translateX(0);
}

/* ===== 面板头部 ===== */
.panel-header {
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--overlay-hover);
  background: var(--overlay-surface);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.15em;
  color: var(--color-text-primary);
}

.header-date {
  font-size: 11px;
  font-family: monospace;
  color: var(--color-text-disabled);
  flex: 1;
  text-align: center;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  background: var(--color-green);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.abort-btn {
  color: var(--color-empire);
  font-size: 14px;
  font-weight: 800;
  padding: 4px 8px;
  line-height: 1;
}

/* ===== 面板主体（可滚动） ===== */
.panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
}

/* ===== 通用区块 ===== */
.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--color-text-disabled);
  letter-spacing: 0.15em;
  font-weight: 700;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: end;
}

.section-meta {
  font-size: 11px;
  font-family: monospace;
  color: var(--color-text-secondary);
}

/* ===== 卡片 ===== */
.card {
  background: var(--neo-surface);
  border: 1px solid var(--overlay-hover);
  border-radius: 8px;
  padding: 10px;
}

/* 操作者卡片 */
.player-card {
  display: flex;
  gap: 10px;
  align-items: center;
}

.player-portrait {
  width: 40px;
  height: 52px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--overlay-border);
  flex-shrink: 0;
}

.player-info {
  flex: 1;
  min-width: 0;
}

.player-name {
  font-size: 13px;
  font-weight: 900;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-role {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-cyan);
  margin-top: 2px;
}

.player-vote {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  margin-top: 6px;
}

.vote-label { color: var(--color-text-secondary); }
.vote-value { color: var(--color-green); font-family: monospace; }

.vote-bar {
  width: 100%;
  height: 4px;
  background: var(--neo-surface);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.vote-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s;
}

/* 政治生态 */
.stance-bar {
  width: 100%;
  height: 6px;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.stance-hawk { background: var(--color-empire); height: 100%; }
.stance-neutral { background: var(--color-text-disabled); height: 100%; }
.stance-cons { background: var(--color-alliance); height: 100%; }

.member-list { display: flex; flex-direction: column; gap: 4px; }

.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.member-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.member-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--overlay-border);
  flex-shrink: 0;
}

.member-name {
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.member-rank {
  color: var(--color-text-disabled);
  font-family: monospace;
  font-size: 10px;
}

.member-stance {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 700;
  border: 1px solid;
}

.member-stance.stance-hawk { background: var(--color-empire-dim); color: var(--color-empire); border-color: var(--color-empire); }
.member-stance.stance-cons { background: var(--color-alliance-dim); color: var(--color-alliance); border-color: var(--color-alliance); }
.member-stance.stance-neutral { background: var(--color-overlay-pressed); color: var(--color-text-secondary); border-color: var(--color-border); }

/* ===== 待处理提案列表 ===== */
.proposal-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.proposal-card {
  background: var(--overlay-surface);
  border: 1px solid var(--overlay-hover);
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.proposal-card:hover {
  border-color: var(--color-cyan-muted);
  background: var(--neo-surface);
  transform: translateX(-2px);
}

.proposal-tag {
  font-size: 9px;
  font-family: monospace;
  color: var(--color-text-disabled);
  padding: 2px 8px;
  background: var(--color-background-muted);
  border-radius: 4px;
  width: fit-content;
  letter-spacing: 0.05em;
  font-weight: 700;
}

/* 7 种提案标签颜色（v3 瘦身后） */
.prop-tag-invasion { color: var(--color-empire); background: var(--color-empire-dim); }
.prop-tag-defense { color: var(--color-alliance); background: var(--color-alliance-dim); }
.prop-tag-budget { color: var(--color-warning); background: rgba(234, 179, 8, 0.15); }
.prop-tag-personnel { color: var(--color-cyan); background: var(--color-cyan-muted); }
.prop-tag-conscription { color: var(--color-purple); background: rgba(168, 85, 247, 0.15); }
.prop-tag-morale_boost { color: #fb923c; background: rgba(251, 146, 60, 0.15); }
.prop-tag-fortify { color: #a78bfa; background: rgba(167, 139, 250, 0.15); }

.proposal-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.proposal-desc {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin: 0;
}

.proposal-risk {
  font-size: 10px;
  color: var(--color-empire);
  font-weight: 600;
  margin-top: 2px;
}

/* 提案人角色化台词 */
.proposal-dialogue {
  font-size: 11px;
  color: var(--color-cyan);
  font-style: italic;
  line-height: 1.4;
  margin: 0;
  padding-left: 8px;
  border-left: 2px solid var(--color-cyan-muted);
}

/* ===== 唱票明细 ===== */
.vote-breakdown {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.vote-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  padding: 3px 8px;
  background: var(--color-overlay-pressed);
  border-radius: 3px;
}

.vote-name {
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vote-name-self {
  font-weight: 800;
}

.vote-stance {
  font-weight: 800;
  font-size: 10px;
  flex-shrink: 0;
  width: 34px;
  text-align: center;
}

.vote-yes { color: var(--color-green); }
.vote-no { color: var(--color-empire); }

.vote-weight {
  color: var(--color-text-disabled);
  font-family: monospace;
  font-size: 10px;
  flex-shrink: 0;
  width: 34px;
  text-align: right;
}

/* ===== 历史决议 ===== */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  padding: 6px 10px;
  background: var(--color-overlay-pressed);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  gap: 8px;
}

.history-item.approved { border-left: 2px solid var(--color-green); }
.history-item.rejected { border-left: 2px solid var(--color-empire); }

.history-name {
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-status {
  font-weight: 900;
  font-size: 10px;
  flex-shrink: 0;
}

.history-status.approved { color: var(--color-green); }
.history-status.rejected { color: var(--color-empire); }

.history-date {
  color: var(--color-text-disabled);
  font-family: monospace;
  font-size: 10px;
  flex-shrink: 0;
}

/* ===== 空状态 ===== */
.empty-state {
  color: var(--color-text-disabled);
  font-size: 11px;
  font-family: monospace;
  text-align: center;
  padding: 12px 0;
  text-transform: uppercase;
}

/* ===== 详情确认卡 ===== */
.proposal-detail-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 95;
  padding: 24px;
}

.proposal-detail-card {
  background: var(--neo-body);
  border: 1px solid var(--overlay-hover);
  border-radius: 12px;
  padding: 20px;
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--color-text-primary);
  margin: 0;
}

.detail-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.detail-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
  line-height: 1.4;
}

.detail-label {
  color: var(--color-text-disabled);
  font-weight: 700;
  flex-shrink: 0;
  width: 60px;
}

.detail-value {
  color: var(--color-text-secondary);
  flex: 1;
  word-break: break-word;
}

.detail-warn {
  color: var(--color-empire);
}

.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
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

.btn-reject {
  color: var(--color-red, #ef4444);
  border-color: var(--color-red, #ef4444);
  font-weight: 800;
  flex: 1;
}

.btn-reject:hover {
  background: var(--color-red, #ef4444);
  color: var(--neo-body);
}

/* ===== 响应式 ===== */
@media (max-width: 520px) {
  .council-panel {
    width: 100vw;
  }
  .proposal-detail-card {
    max-width: 100%;
  }
}
</style>
