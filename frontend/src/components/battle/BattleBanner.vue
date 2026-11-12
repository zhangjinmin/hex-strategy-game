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

  <!-- [v99] 常驻"本场战损"角标已移除：它有两个问题——
       ① 窗口变窄时会盖住画面（用户实报）；
       ② 账本跨局不清零 ⇒ 新开一轮还挂着上一场的数字（用户实报）。
       现在战损只在**战后结算**里呈现（见 SettlementModal），战斗中不再常驻。 -->
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

</script>

<style scoped>
.battle-banner {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 70; pointer-events: none; text-align: center;
  animation: bb-in var(--ui-dur-cine) var(--ui-ease);
}
@keyframes bb-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.86); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
}
/* 上下两道细线：把横幅从「浮在空中的字」变成「舰桥指令幕」 */
.battle-banner::before,
.battle-banner::after {
  content: ''; display: block; height: 1px; margin: 0 auto;
  width: min(560px, 72vw);
  background: linear-gradient(to right, transparent, var(--ui-line-strong), transparent);
}
.battle-banner::before { margin-bottom: var(--ui-2); }
.battle-banner::after { margin-top: var(--ui-3); }
.bb-title {
  display: inline-block;
  font-family: var(--ui-display-font);
  font-size: var(--fs-h1);
  font-weight: var(--ui-display-weight);
  letter-spacing: 0.2em;
  padding: var(--ui-2) var(--ui-6);
  background: var(--ui-panel);
  border: 1px solid;
  border-radius: var(--ui-radius);
  box-shadow: var(--ui-shadow-panel);
}
.bb-sub {
  margin-top: var(--ui-2);
  font-family: var(--ui-display-font);
  font-size: var(--fs-label);
  color: var(--ui-ink-2);
  letter-spacing: 0.24em;
}
</style>
