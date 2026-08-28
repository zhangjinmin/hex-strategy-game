<template>
  <div class="modal-overlay animate-fade" v-if="store.gameOver">
    <div class="modal-content neo-card">
      <h2 :class="store.isWin ? 'text-gold' : 'text-red'">{{ store.isWin ? '战役胜利' : '战役失败' }}</h2>
      <p class="status-text">{{ store.winStatus }}</p>
      
      <div class="reward-box neo-inset">
        <p>本次战役结算经费: <span class="text-gold">+{{ store.rewardGold }} 亿</span></p>
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
.modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--overlay-scrim); z-index: 999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.modal-content { width: 400px; padding: 30px; text-align: center; border: 1px solid var(--overlay-border); }
h2 { margin: 0 0 10px 0; font-size: 28px; font-weight: 900; }
.status-text { color: var(--color-text-secondary); font-size: 14px; margin-bottom: 20px; font-weight: 600; }
.reward-box { padding: 15px; border-radius: 8px; margin: 15px 0; }
.reward-box p { margin: 5px 0; font-size: 14px; font-weight: 800; color: var(--color-text-primary); }
</style>