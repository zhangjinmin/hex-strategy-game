<template>
  <!-- [W1.1] 阶段横幅（DOM 可见层）：3D 模式下 Phaser 画布被 CSS 隐藏，画在画布上的
       BattleScene.showBattleBanner 不可见 ⇒ 由 store.battleBanner 驱动本 DOM 渲染。
       单例：新横幅整体替换（key=ts 重播动画），2.2s 后由 store 自动消隐。 -->
  <div
    v-if="banner"
    :key="banner.ts"
    class="battle-banner"
  >
    <div class="bb-title" :style="{ color: banner.color, borderColor: banner.color, textShadow: '0 0 18px ' + banner.color }">
      {{ banner.title }}
    </div>
    <div class="bb-sub">{{ banner.subtitle }}</div>
  </div>

  <!-- [W1.2] 战损账单（左上角常驻，常显于 3D）：原为 Phaser 画布文字（不可见）⇒ 改 DOM 角标。
       top 下移到顶栏舰队卡（纵向上限 200px）之下，避免与 GameHeader 重叠。 -->
  <div v-if="lossText" class="battle-loss">{{ lossText }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore();

const unwrap = (x: any) => (x && typeof x === 'object' && 'value' in x ? x.value : x);

const banner = computed<{ title: string; subtitle: string; color: string; ts: number } | null>(() => {
  const v = unwrap((store as any).battleBanner);
  return (v && v.title) ? v : null;
});

const lossText = computed<string>(() => {
  const v = unwrap((store as any).battleLossText);
  return typeof v === 'string' ? v : '';
});
</script>

<style scoped>
.battle-banner {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 40;
  pointer-events: none;
  text-align: center;
  animation: bb-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes bb-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.86); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
}
.bb-title {
  display: inline-block;
  font-family: monospace;
  font-size: 30px;
  font-weight: 900;
  letter-spacing: 3px;
  padding: 8px 24px;
  background: rgba(4, 8, 16, 0.75);
  border: 1px solid;
  border-radius: 4px;
}
.bb-sub {
  margin-top: 10px;
  font-family: monospace;
  font-size: 13px;
  color: #94a3b8;
  letter-spacing: 2px;
}
.battle-loss {
  position: fixed;
  left: 16px;
  top: 214px;
  z-index: 30;
  pointer-events: none;
  font-family: monospace;
  font-size: 12px;
  font-weight: 900;
  color: #ef4444;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
  border-radius: 4px;
}
</style>
