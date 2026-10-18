<template>
  <div class="ui-footer neo-card">
    <span v-if="deployPhase" class="text-deploy">◤ 战前部署 ◢ 阵型:{{ formCn }} 姿态:{{ tacticCn }} · 回车开战</span>
    <span v-else-if="isPaused" class="text-pause-blink">系统演算已暂停</span>
    
    <span v-else-if="activeTile">
      侦测坐标: [{{ activeTile.q }},{{ activeTile.r }}] 节点类别: {{ activeTile.type }} | 结构: {{ activeTile.hp }} / {{ activeTile.maxHp }}
    </span>
    
    <template v-else>
      <!-- [W5.1] 战中 `1-5` = 速度档（阵型键只在部署期有效）。旧文案写「1-5·阵型」与实现矛盾，
           是"想调速却改了阵型"的误导来源之一 —— 此处按阶段写成正确语义。 -->
      <span class="hidden-on-mobile">态势: {{ diffName }} | 指令: 空格·指挥点面板 · 1-5·速度档 · X·分舰队</span>
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

// [W4.2] 部署期常驻状态条数据源（BattleScene 镜像写入 store）。
//   此前部署期 footer 只显示"系统演算已暂停" ⇒ 玩家以为卡死；现改为显示阵型/姿态/开战提示。
const deployPhase = computed(() => {
  const raw = (store as any).battleDeployPhase;
  return raw?.value !== undefined ? !!raw.value : !!raw;
});
const FORM_CN: Record<string, string> = { wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵' };
const TACTIC_CN: Record<string, string> = { search: '索敌', siege: '攻坚', defend: '驻守' };
const rawDeployFormation = computed(() => {
  const raw = (store as any).deployFormation;
  return raw?.value !== undefined ? raw.value : (raw || 'wedge');
});
const rawDeployTactic = computed(() => {
  const raw = (store as any).deployTactic;
  return raw?.value !== undefined ? raw.value : (raw || 'search');
});
const formCn = computed(() => FORM_CN[rawDeployFormation.value] || rawDeployFormation.value);
const tacticCn = computed(() => TACTIC_CN[rawDeployTactic.value] || rawDeployTactic.value);
</script>

<style scoped>
.ui-footer { 
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 10px 24px; border-radius: 99px; font-size: calc(12px * var(--font-scale)); color: var(--color-text-secondary); z-index: 10; font-weight: 800;
}
.text-pause-blink { color: var(--color-warning); animation: blink 1s infinite; }
.text-deploy { color: #00ff88; font-weight: 900; letter-spacing: 0.5px; }
@keyframes blink { 50% { opacity: 0.5; } }

@media (max-width: 768px) {
  .ui-footer { bottom: 5px; padding: 8px 12px; font-size: calc(10px * var(--font-scale)); width: 95%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}
</style>