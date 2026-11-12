<template>
  <div class="modal-overlay animate-fade" v-if="store.gameOver">
    <div class="modal-content neo-card">
      <h2 :class="store.isWin ? 'text-gold' : 'text-red'">{{ store.isWin ? '战役胜利' : '战役失败' }}</h2>
      <p class="status-text">{{ store.winStatus }}</p>
      
      <div class="reward-box neo-inset">
        <!-- [v99] 用户要求：把"赚了多少钱"换成**战役损失**。
             损失账本由 BattleScene 逐帧维护、写入 store.battleLossText；
             现在它是唯一的呈现点（战斗中的常驻角标已移除）。 -->
        <p>战役损失: <span class="text-red">{{ store.battleLossText || '无舰船损失' }}</span></p>
        <!-- [v99] **不再显示"结算经费"**：用户质疑"打完一仗不是该花钱吗，怎么还赚 245 亿"。
             这个数是战役胜利的财政奖励，与"这一仗付出什么"是两件事，放在同一个框里只会打架。
             胜负与损失在一处说清；经费去战报/经济面板看。
             ⚠ 只是**不在这里显示**，`store.rewardGold` 的结算逻辑本身没动。 -->
      </div>
      
      <button @click="store.returnToMetaMenu()" class="neo-btn w-full mt-6 py-3 text-lg">返回统合作战本部</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGameStore } from '../../store/gameStore';
const store = useGameStore();
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: var(--ui-scrim); z-index: 999;
  display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px);
}
.modal-content {
  width: 560px; max-width: 92vw; padding: var(--ui-6) var(--ui-5); text-align: center;
  border: var(--ui-frame-strong); border-radius: var(--ui-radius);
  background: var(--ui-panel-solid); box-shadow: var(--ui-shadow-panel);
}
h2 {
  margin: 0 0 var(--ui-2) 0; font-family: var(--ui-display-font);
  font-size: var(--fs-display); font-weight: var(--ui-display-weight);
  letter-spacing: var(--ui-display-tracking);
}
.status-text { color: var(--ui-ink-2); font-size: var(--fs-body); margin-bottom: var(--ui-4); font-weight: 600; line-height: 1.6; }
.loss-sub { color: var(--ui-ink-2); font-size: var(--fs-label); margin-top: 6px; font-weight: 700; }
.reward-box { padding: var(--ui-3); border-radius: var(--ui-radius); margin: var(--ui-3) 0 var(--ui-4); }
.reward-box p { margin: 0; font-size: var(--fs-body); font-weight: 800; color: var(--ui-ink); line-height: 1.6; }
</style>