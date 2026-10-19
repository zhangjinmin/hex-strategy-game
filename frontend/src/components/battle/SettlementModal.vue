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
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--overlay-scrim); z-index: 999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.modal-content { width: 400px; padding: 30px; text-align: center; border: 1px solid var(--overlay-border); }
h2 { margin: 0 0 10px 0; font-size: calc(28px * var(--font-scale)); font-weight: 900; }
.status-text { color: var(--color-text-secondary); font-size: calc(14px * var(--font-scale)); margin-bottom: 20px; font-weight: 600; }
/* [v99] 损失为主、经费为次：损失用主字号，经费降到次级行，避免两条数字抢注意力 */
.loss-sub { color: var(--color-text-secondary); font-size: calc(12px * var(--font-scale)); margin-top: 6px; font-weight: 700; }
.reward-box { padding: 15px; border-radius: 8px; margin: 15px 0; }
.reward-box p { margin: 5px 0; font-size: calc(14px * var(--font-scale)); font-weight: 800; color: var(--color-text-primary); }
</style>