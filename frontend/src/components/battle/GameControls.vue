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

    <!-- [W5.2] 指挥点面板入口：11 条指挥技能此前**只有空格键**能打开，玩家不知道有该系统。
         本按钮与空格键走**同一条**实现（commandBridge.panelToggleRequest → BattleScene
         openCommandPanel/closeCommandPanel），并显示当前 CP。 -->
    <button @click="toggleCommandPanel" class="neo-btn btn-ctrl" :class="{ 'active-cp': commandBridge.visible }" :title="'指挥点面板（快捷键：空格）'">
      ⚡ 指挥点{{ cpText }} <span class="cp-key">(空格)</span>
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

    <!-- 演习模式：撤退（[v102] 加二次确认 —— Esc 退出已移除后，这是唯一出口，不能一点就走） -->
    <button v-if="!isCampaign" @click="confirmLeaveSim" class="neo-btn text-red">撤退</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore } from '../../store/gameStore';
import { commandBridge } from '../../services/CommandBridge';

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

// [W5.2] 当前 CP（commandBridge.cpState 由 BattleScene 每帧常驻镜像；未就绪时不显示数字）
const cpText = computed<string>(() => {
  const cp: any = commandBridge.cpState;
  if (!cp || typeof cp.currentCP !== 'number') return '';
  return ` ${Math.floor(cp.currentCP)}/${Math.floor(cp.maxCP)}`;
});

// [W5.2] 指挥点面板入口：与空格键走同一条实现 —— 仅递增请求计数，
//   BattleScene 每帧消费后走 openCommandPanel()/closeCommandPanel()（键盘与按钮零分叉）。
const toggleCommandPanel = () => {
  commandBridge.panelToggleRequest++;
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

// [v102] 演习撤退：Esc 退出已移除 ⇒ 本按钮是唯一出口，必须二次确认（与战役轨一致）
const confirmLeaveSim = () => {
  if (!confirm('确定退出本次演习吗？\n\n战斗进度不会保留。')) return;
  store.returnToMetaMenu();
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
.game-controls { display: flex; gap: var(--ui-2); align-items: center; pointer-events: auto; }
.speed-controls { display: flex; gap: var(--ui-1); padding: var(--ui-1); border-radius: var(--ui-radius); }
.btn-speed {
  min-height: 36px; padding: 0 var(--ui-2); background: transparent; border: 1px solid transparent;
  color: var(--ui-ink-3); font-size: var(--fs-label); font-weight: 800;
  font-variant-numeric: tabular-nums; cursor: pointer;
  border-radius: var(--ui-radius); transition: color var(--ui-dur-micro), background var(--ui-dur-micro);
}
.btn-speed:hover { color: var(--ui-ink); background: var(--ui-accent-soft); }
.btn-speed.active { background: var(--ui-accent); color: var(--ui-accent-ink); }
.btn-ctrl { min-height: 38px; padding: 0 var(--ui-2); }
.active-bomb { border-color: var(--dmc-danger) !important; color: var(--dmc-danger) !important; }
.active-cp { border-color: var(--ui-accent); color: var(--ui-accent); box-shadow: var(--ui-glow); }
.cp-key { opacity: 0.6; font-size: var(--fs-caption); }
@keyframes pulse-red { 50% { box-shadow: 0 0 12px var(--dmc-danger); } }
</style>