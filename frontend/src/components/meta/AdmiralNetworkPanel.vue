<template>
  <div class="network-overlay" @click.self="$emit('close')">
    <div class="network-card neo-card">
      <div class="flex-header">
        <h3 class="text-gold m-0">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:6px;"><circle cx="5" cy="5" r="3"/><circle cx="11" cy="5" r="3"/><circle cx="8" cy="11" r="3"/><line x1="6.5" y1="7.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="7.5" x2="6.5" y2="9.5"/></svg>
          提督关系网
        </h3>
        <button class="neo-btn text-red px-3" @click="$emit('close')">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>

      <!-- 关系图 -->
      <div class="network-canvas" ref="canvasRef">
        <svg viewBox="-300 -200 600 400" class="network-svg">
          <!-- 连线 -->
          <line v-for="(link, i) in links" :key="'l'+i"
            :x1="link.x1" :y1="link.y1" :x2="link.x2" :y2="link.y2"
            :stroke="link.color" :stroke-width="link.width"
            :stroke-dasharray="link.dashed ? '4,3' : ''" opacity="0.6" />
          <!-- 节点 -->
          <g v-for="(adm, i) in nodes" :key="'n'+i" @click="selectAdmiral(adm)"
            class="node-group" :class="{ selected: selectedAdm?.id === adm.id }">
            <circle :cx="adm.x" :cy="adm.y" :r="adm.isPlayer ? 10 : 7"
              :fill="adm.color" stroke="#fff" stroke-width="1.5"
              :opacity="adm.isPlayer ? 1 : 0.8" />
            <text :x="adm.x" :y="adm.y + 16" text-anchor="middle"
              :fill="adm.isPlayer ? '#fbbf24' : '#94a3b8'" font-size="9" font-weight="bold"
              class="node-label">{{ adm.shortName }}</text>
          </g>
        </svg>
      </div>

      <!-- 已选提督详情 + 对话 -->
      <div class="detail-panel" v-if="selectedAdm">
        <div class="detail-header">
          <img :src="getPortrait(selectedAdm.imageId)" class="detail-portrait" @error="e => (e.target as any).src=''" />
          <div>
            <div class="detail-name" :class="selectedAdm.faction === 'empire' ? 'text-red' : 'text-cyan'">
              {{ selectedAdm.rankName }} {{ selectedAdm.name }}
            </div>
            <div class="detail-relation">
              关系: {{ relationLabel }} ({{ selectedAdm.loyalty || selectedAdm.hiddenStats?.loyalty || 50 }})
              <span :class="relationColor">●</span>
            </div>
          </div>
        </div>
        <div class="dialogue-box">
          <div class="dialogue-text" v-html="currentDialogue"></div>
        </div>
        <div class="dialogue-actions">
          <button class="neo-btn text-xs" @click="cycleDialogue" v-if="dialogueCount > 1">另一句</button>
        </div>
      </div>
      <div class="detail-panel text-muted" v-else>
        <p>点击一名提督查看关系与对话</p>
      </div>

      <button class="neo-btn text-red w-full mt-2 py-2" @click="$emit('close')">关闭</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';

const props = defineProps<{ faction: string }>();
const emit = defineEmits(['close']);
const store = useGameStore() as any;

const allAdmirals = computed(() => store.allAdmirals?.value || store.allAdmirals || []);
const selectedAdm = ref<any>(null);
const dialogueIndex = ref(0);

// 玩家提督
const playerAdm = computed(() => allAdmirals.value.find((a: any) => a.id === store.playerAdmiralId));

// 同阵营提督（前8个最高级）
const factionAdmirals = computed(() => {
  return allAdmirals.value
    .filter((a: any) => a.faction === props.faction && a.id !== store.playerAdmiralId)
    .sort((a: any, b: any) => (b.stats?.command || 0) - (a.stats?.command || 0))
    .slice(0, 8);
});

// 计算节点位置（Circle layout）
const nodes = computed(() => {
  const list: any[] = [];
  const center = playerAdm.value;
  if (center) {
    list.push({
      ...center, shortName: center.name?.charAt(0) || '?',
      x: 0, y: 0,
      color: props.faction === 'empire' ? '#ef4444' : '#06b6d4',
      isPlayer: true,
    });
  }
  const others = factionAdmirals.value;
  const r = 120 + others.length * 8;
  others.forEach((a: any, i: number) => {
    const angle = (Math.PI * 2 / others.length) * i - Math.PI / 2;
    list.push({
      ...a, shortName: a.name?.charAt(0) || '?',
      x: Math.cos(angle) * r, y: Math.sin(angle) * r,
      color: '#334155',
      isPlayer: false,
    });
  });
  return list;
});

// 连线
const links = computed(() => {
  const playerNode = nodes.value.find(n => n.isPlayer);
  return nodes.value
    .filter(n => !n.isPlayer)
    .map(to => {
      const loyalty = to.loyalty || to.hiddenStats?.loyalty || 50;
      let color = '#64748b';
      if (loyalty > 70) color = '#34d399';
      else if (loyalty < 30) color = '#f87171';
      return {
        x1: playerNode?.x || 0, y1: playerNode?.y || 0,
        x2: to.x, y2: to.y,
        color, width: loyalty > 70 ? 2 : 1,
        dashed: loyalty < 30,
      };
    });
});

const relationLabel = computed(() => {
  const v = selectedAdm.value?.loyalty || selectedAdm.value?.hiddenStats?.loyalty || 50;
  if (v > 70) return '信赖';
  if (v > 40) return '中立';
  return '冷淡';
});

const relationColor = computed(() => {
  const v = selectedAdm.value?.loyalty || selectedAdm.value?.hiddenStats?.loyalty || 50;
  return v > 70 ? 'text-emerald' : v > 40 ? 'text-muted' : 'text-red';
});

// 对话系统
const dialogueTemplates: Record<string, string[]> = {
  'high': [
    '「和你并肩作战我感到荣幸。有什么需要我的舰队，尽管开口。」',
    '「我认可你的战略眼光。这次行动请让我打头阵。」',
    '「陛下（议长）对你的评价很高。好好干。」',
  ],
  'mid': [
    '「作战部署我已知悉。我的舰队随时待命。」',
    '「最近的局势令人担忧……你有什么想法？」',
    '「有情报说敌方在加强边境防御，注意安全。」',
  ],
  'low': [
    '「……我不太赞同你上次的提案。但这不意味着我会违抗命令。」',
    '「别以为你军阶高就可以为所欲为。我会看着你的。」',
    '「（沉默。）……没什么想说的。」',
  ],
};

const dialogueCount = computed(() => {
  if (!selectedAdm.value) return 0;
  const v = selectedAdm.value.loyalty || selectedAdm.value.hiddenStats?.loyalty || 50;
  const key = v > 70 ? 'high' : v > 40 ? 'mid' : 'low';
  return dialogueTemplates[key]?.length || 0;
});

const currentDialogue = computed(() => {
  if (!selectedAdm.value) return '';
  const v = selectedAdm.value.loyalty || selectedAdm.value.hiddenStats?.loyalty || 50;
  const key = v > 70 ? 'high' : v > 40 ? 'mid' : 'low';
  const dialogues = dialogueTemplates[key];
  return dialogues?.[dialogueIndex.value % dialogues.length] || '……';
});

const selectAdmiral = (adm: any) => {
  selectedAdm.value = adm;
  dialogueIndex.value = 0;
};

const cycleDialogue = () => {
  dialogueIndex.value++;
};
</script>

<style scoped>
.network-overlay {
  position: fixed; inset: 0; z-index: 3600;
  background: var(--overlay-scrim);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px);
}
.network-card {
  width: 680px; max-width: 95vw; max-height: 88vh;
  padding: 24px; display: flex; flex-direction: column; gap: 14px;
  overflow-y: auto;
}
.flex-header { display: flex; justify-content: space-between; align-items: center; }
.m-0 { margin: 0; font-size: 18px; font-weight: 900; }
.px-3 { padding: 6px 12px; }

.network-canvas {
  background: rgba(0,0,0,0.3); border-radius: 8px;
  border: 1px solid var(--overlay-hover);
  overflow: hidden;
}
.network-svg { width: 100%; height: auto; }
.node-group { cursor: pointer; transition: opacity 0.15s; }
.node-group:hover { opacity: 0.85; }
.node-group.selected circle { stroke: #fbbf24; stroke-width: 2.5; }
.node-label { pointer-events: none; user-select: none; }

.detail-panel {
  background: var(--overlay-surface); border: 1px solid var(--overlay-hover);
  border-radius: 8px; padding: 12px; min-height: 60px;
}
.detail-header { display: flex; gap: 10px; align-items: center; }
.detail-portrait { width: 40px; height: 48px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); }
.detail-name { font-size: 14px; font-weight: 800; }
.detail-relation { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; }
.dialogue-box {
  margin-top: 8px; padding: 10px 12px;
  background: rgba(0,0,0,0.3); border-left: 3px solid var(--color-cyan);
  border-radius: 4px; font-size: 13px; color: var(--color-text-secondary);
  font-style: italic; line-height: 1.5;
}
.dialogue-actions { margin-top: 6px; display: flex; gap: 6px; }
.w-full { width: 100%; }
.mt-2 { margin-top: 8px; }
.py-2 { padding: 8px 0; }

.text-red { color: var(--color-empire) !important; }
.text-cyan { color: var(--color-cyan) !important; }
.text-gold { color: var(--color-warning); }
.text-muted { color: var(--color-text-disabled); font-size: 12px; text-align: center; }
.text-xs { font-size: 11px; }
.text-emerald { color: var(--color-green) !important; }
</style>
