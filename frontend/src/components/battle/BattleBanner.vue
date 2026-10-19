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
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  /* [R3] z-index 40 → 70：原值低于 `BattleIntroOverlay` 部署全屏层（z-index 60）
     ⇒ 部署期的两条阶段横幅（W4.3「战前部署」/ W4.1「部署时间到」）被近不透明全屏层完全压住、
     默认流程下**根本看不到**。抬到 70 ⇒ 高于部署层。
     ⚠ 本横幅 `pointer-events: none` ⇒ 抬高后**不遮挡**部署层的阵型/姿态/开战操作区。
     ⚠ `.battle-loss`（z-index 30）无需抬高：它只在 `deployPhase===false`（战斗期，部署层已卸载）显示。 */
  z-index: 70;
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
  font-family: var(--font-family);
  font-size: calc(30px * var(--font-scale));
  font-weight: 900;
  letter-spacing: 3px;
  padding: 8px 24px;
  background: rgba(4, 8, 16, 0.75);
  border: 1px solid;
  border-radius: 4px;
}
.bb-sub {
  margin-top: 10px;
  font-family: var(--font-family);
  font-size: calc(13px * var(--font-scale));
  color: #94a3b8;
  letter-spacing: 2px;
}
.battle-loss {
  position: fixed;
  left: 16px;
  top: 214px;
  z-index: 30;
  pointer-events: none;
  font-family: var(--font-family);
  font-size: calc(12px * var(--font-scale));
  font-weight: 900;
  color: #ef4444;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
  border-radius: 4px;
}
</style>
