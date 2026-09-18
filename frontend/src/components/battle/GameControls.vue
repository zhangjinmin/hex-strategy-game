<template>
  <div class="game-controls">
    <div class="speed-controls neo-card">
      <button 
        v-for="s in speedList" 
        :key="String(s)" 
        @click="setSpeed(s)" 
        class="btn-speed" 
        :class="{ active: currentSpeed === s }"
      >
        {{ s }}x
      </button>
    </div>
    
    <button @click="toggleBomb" class="neo-btn btn-ctrl" :class="{'active-bomb': isBombing}">
      {{ isBombing ? '锁定坐标(右键取消)' : '主炮(200)' }}
    </button>
    
    <button @click="togglePause" class="neo-btn btn-ctrl text-gold">
      {{ isPaused ? '▶ 继续' : '⏸ 暂停' }}
    </button>

    <!-- 战役模式专属：AI 裁决 + 撤退 -->
    <template v-if="isCampaign">
      <button @click="autoResolve" class="neo-btn btn-ctrl text-cyan">
        ⚖ AI裁决
      </button>
      <button @click="confirmRetreat" class="neo-btn btn-ctrl text-red">
        ⚠ 撤退
      </button>
    </template>

    <!-- 演习模式：返回菜单 -->
    <button v-if="!isCampaign" @click="store.returnToMetaMenu()" class="neo-btn text-red">撤退</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore();

// 战役模式判定
const isCampaign = computed(() => {
  const ts = (store as any).tacticalState;
  const state = ts?.value !== undefined ? ts.value : ts;
  return state && state.mode === 'campaign';
});

// 1. 安全提取数组
const speedList = computed<number[]>(() => {
  const raw = (store as any).speedGears;
  return raw?.value !== undefined ? raw.value : (raw || [0.5, 1.0, 1.5, 2.0, 3.0]);
});

// 2. 核心修复：强制解包为纯 number
const currentSpeed = computed<number>(() => {
  const raw = (store as any).currentSpeedFactor;
  return raw?.value !== undefined ? raw.value : (raw || 1.0);
});

// 3. 安全提取轰炸状态
const isBombing = computed<boolean>(() => {
  const raw = (store as any).isCastingBomb;
  return raw?.value !== undefined ? raw.value : (raw || false);
});

// 4. 安全提取暂停状态
const isPaused = computed<boolean>(() => {
  const raw = (store as any).isPaused;
  return raw?.value !== undefined ? raw.value : (raw || false);
});

// 5. 设置速度
const setSpeed = (s: number) => {
  (store as any).currentSpeedFactor = s;
};

const toggleBomb = () => {
  const raw = (store as any).isCastingBomb;
  const currentVal = raw?.value !== undefined ? raw.value : raw;
  (store as any).isCastingBomb = !currentVal;
};

const togglePause = () => {
  // 【A1 修复】战前部署阶段：暂停按钮不得解除部署暂停（否则部署菜单还开着，舰队却已开战机动）。
  // 部署期唯一正确的"开战"入口是回车键 / startBattleAfterDeploy。
  if ((store as any).battleDeployPhase) {
    if (typeof (store as any).triggerToast === 'function') {
      (store as any).triggerToast('战前部署中：按 [回车] 立即开战');
    }
    return;
  }
  if (typeof (store as any).togglePause === 'function') {
    (store as any).togglePause();
  } else {
    const raw = (store as any).isPaused;
    const currentVal = raw?.value !== undefined ? raw.value : raw;
    (store as any).isPaused = !currentVal;
  }
};

// AI 裁决：基于双方当前剩余兵力自动结算
const autoResolve = () => {
  if (!confirm('确定要交由 AI 裁决战斗结果吗？\n\n将基于双方当前剩余兵力自动结算，无法撤回。')) return;
  if (typeof (store as any).autoResolveFromBattle === 'function') {
    (store as any).autoResolveFromBattle();
  }
};

// 撤退：确认后返回战略界面
const confirmRetreat = () => {
  if (!confirm('确定要撤退吗？\n\n撤退将损失部分舰艇，舰队将返回上一友方据点。')) return;
  if (typeof (store as any).retreatFromBattle === 'function') {
    (store as any).retreatFromBattle();
  } else {
    // 回退：直接返回战略
    (store as any).returnToMetaMenu();
  }
};
</script>

<style scoped>
.game-controls { 
    display: flex; gap: 10px; align-items: center; 
    pointer-events: auto; 
}
.speed-controls { display: flex; gap: 4px; padding: 4px; border-radius: 6px; }
.btn-speed { background: transparent; border: none; color: var(--color-text-disabled); font-size: 12px; font-weight: 800; padding: 4px 8px; cursor: pointer; transition: all 0.2s; border-radius: 4px; }
.btn-speed:hover { color: var(--color-text-secondary); }
.btn-speed.active { background: var(--color-cyan); color: var(--neo-surface); }
.btn-ctrl { padding: 6px 12px; font-size: 12px; font-weight: 800; }
.active-bomb { border-color: var(--color-empire); color: var(--color-empire); animation: pulse-red 1s infinite; }
@keyframes pulse-red { 50% { box-shadow: 0 0 10px var(--color-empire); } }
</style>