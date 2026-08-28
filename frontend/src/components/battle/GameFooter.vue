<template>
  <div class="ui-footer neo-card">
    <span v-if="isPaused" class="text-pause-blink">系统演算已暂停</span>
    
    <span v-else-if="activeTile">
      侦测坐标: [{{ activeTile.q }},{{ activeTile.r }}] 节点类别: {{ activeTile.type }} | 结构: {{ activeTile.hp }} / {{ activeTile.maxHp }}
    </span>
    
    <template v-else>
      <span class="hidden-on-mobile">态势: {{ diffName }} | 指令: 空格暂停, 1-5调速, T主炮</span>
      <span class="mobile-only-text">触控空域建立跃迁点</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore();

// 1. 兼容 TS 误判：安全提取 isPaused
const isPaused = computed(() => {
  const raw = (store as any).isPaused;
  return raw?.value !== undefined ? raw.value : (raw || false);
});

// 2. 兼容 TS 误判：安全提取 selectedDiff 并传给 getDiffName
const diffName = computed(() => {
  const rawDiff = (store as any).selectedDiff;
  const diffLevel = rawDiff?.value !== undefined ? rawDiff.value : (rawDiff || 'normal');
  
  if (typeof (store as any).getDiffName === 'function') {
    return (store as any).getDiffName(diffLevel);
  }
  return '会战';
});

// 3. 核心修复：安全提取 selectedTile，剥离 Ref 壳子
const activeTile = computed(() => {
  const rawTile = (store as any).selectedTile;
  if (!rawTile) return null;
  
  // 双保险：如果 TS 没解包，拿 .value；如果运行期已解包，直接用
  const tile = rawTile.value !== undefined ? rawTile.value : rawTile;
  if (!tile) return null;
  
  return {
    q: tile.q,
    r: tile.r,
    type: tile.type,
    hp: tile.hp,
    maxHp: tile.maxHp
  };
});
</script>

<style scoped>
.ui-footer { 
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 10px 24px; border-radius: 99px; font-size: 12px; color: var(--color-text-secondary); z-index: 10; font-weight: 800;
}
.text-pause-blink { color: var(--color-warning); animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0.5; } }

@media (max-width: 768px) {
  .ui-footer { bottom: 5px; padding: 8px 12px; font-size: 10px; width: 95%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
</style>