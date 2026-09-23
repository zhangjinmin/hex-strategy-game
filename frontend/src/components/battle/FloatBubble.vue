<template>
  <!-- [v59] 旗舰浮动气泡：渲染在可见 DOM（指挥制 Phaser 画布被隐藏，Phaser 气泡不可见）。
       单例：任意时刻至多一条（store.floatBubble 整体替换），锚定旗舰屏幕坐标，2.8s 由 BattleScene 消隐。 -->
  <div
    v-if="b"
    :key="b.ts"
    class="float-bubble"
    :style="{ left: b.x + 'px', top: b.y + 'px', borderColor: b.color }"
  >
    <div class="fb-name" :style="{ color: b.color }">{{ b.name }}</div>
    <div class="fb-text">{{ b.text }}</div>
    <div class="fb-tail" :style="{ borderTopColor: b.color }"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../../store/gameStore';

const store = useGameStore();
const b = computed(() => {
  const raw = (store as any).floatBubble;
  const v = raw?.value !== undefined ? raw.value : raw;
  return v || null;
});
</script>

<style scoped>
.float-bubble {
  position: fixed;
  z-index: 25;
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 14px));
  min-width: 110px;
  max-width: 240px;
  padding: 7px 12px 8px;
  background: rgba(15, 23, 42, 0.95);
  border: 2px solid;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  animation: fb-pop 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fb-pop {
  from { opacity: 0; transform: translate(-50%, calc(-100% - 6px)) scale(0.85); }
}
.fb-name {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 1px;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fb-text {
  font-size: 13px;
  font-weight: 800;
  color: #f8fafc;
  line-height: 1.45;
}
/* 尾巴指向下方旗舰 */
.fb-tail {
  position: absolute;
  left: 50%;
  bottom: -8px;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 8px solid;
}
</style>
