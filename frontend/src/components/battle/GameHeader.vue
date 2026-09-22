<template>
  <div class="ui-header">
    <div class="faction-infos">
      <div v-for="f in factionsList" :key="f.id" class="side-info neo-card" :class="{'inactive': !f.active}" v-show="f.type === 'player' || f.team === 1 || f.inVision">
        <img :src="getPortrait(f.imageId)" class="mini-portrait" @error="handleImgError" />
        <div class="info-content">
          <div class="faction-name" :class="{'text-player': f.type === 'player', 'text-ally': f.type === 'ai' && f.team === 1, 'text-red': f.team === 2}">
            [{{ f.team === 1 ? '我方' : '敌军' }}] {{ f.name }}
          </div>
          <!-- [v57] 面板信息密度升级：舰况/士气/补给三细条 + 编制行；「军费」已随经济项目移除 -->
          <div class="stat-row" v-if="f.active">
            <span class="stat-k">舰况</span>
            <div class="hp-bar-container"><div class="hp-bar-fill" :class="f.team === 1 ? 'bg-cyan' : 'bg-red'" :style="{ width: clampPct(f.hp) + '%' }"></div></div>
            <span class="stat-v">{{ Math.round(clampPct(f.hp)) }}</span>
          </div>
          <div class="stat-row" v-if="f.active">
            <span class="stat-k">士气</span>
            <div class="hp-bar-container"><div class="hp-bar-fill bg-gold" :style="{ width: clampPct(f.morale) + '%' }"></div></div>
            <span class="stat-v">{{ Math.round(clampPct(f.morale)) }}</span>
          </div>
          <div class="stat-row" v-if="f.active">
            <span class="stat-k">补给</span>
            <div class="hp-bar-container"><div class="hp-bar-fill bg-green" :style="{ width: clampPct(f.supply) + '%' }"></div></div>
            <span class="stat-v">{{ Math.round(clampPct(f.supply)) }}</span>
          </div>
          <div class="mini-gold" v-if="f.active">
            编制 <span class="text-cyan">{{ f.unitCount }}/{{ getShipLimit(f.rank) }}</span>
          </div>
          <div class="mini-gold text-red" v-else>舰队已溃散</div>
        </div>
      </div>
    </div>
    <GameControls />
  </div>

  <!-- [v58] 右侧立绘对话框已删：会被军议任务指令侧栏遮挡，闲聊改走旗舰位置浮动气泡（BattleScene.showFleetDialogue） -->
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import GameControls from './GameControls.vue';

const store = useGameStore();

const factionsList = computed<any[]>(() => {
  const raw = (store as any).factions;
  if (!raw) return [];
  const list = raw.value !== undefined ? raw.value : raw;
  return Array.isArray(list) ? list : [];
});

const getShipLimit = (rank: any) => {
  const r = Number(rank) || 1;
  if (typeof (store as any).getShipLimit === 'function') return (store as any).getShipLimit(r);
  return 4;
};

/** [v57] 面板数值防溢出：镜像字段可能 undefined（尚未同步）或超界，统一夹到 0-100 */
const clampPct = (v: any) => Math.max(0, Math.min(100, Number(v) || 0));

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40"><rect width="32" height="40" fill="%231e293b"/></svg>';
};
</script>

<style scoped>
/* 完全独立锚定：faction-infos 绝对定位贴左、GameControls 绝对定位贴右，
   二者不在同一 flex 流里，舰队卡再多/换行也不会把右侧按钮推出视口（实报 bug 根治） */
.ui-header { position: absolute; top: 15px; left: 0; right: 0; z-index: 10; pointer-events: none; }
/* 舰队卡贴左，纵向弹性上限 132px（约两行卡），超出裁剪。
   横向预留 580px 给右侧控制区：实测 GameControls 宽 434px（演习）/ 549px（战役），
   旧的 380px 预留不足，卡片排满时最右侧卡片会钻到按钮底下（1920 下重叠 84px，战役 199px）。 */
.faction-infos { position: absolute; top: 0; left: 15px; display: flex; gap: 10px; flex-wrap: wrap; pointer-events: auto; max-width: calc(100% - 580px); max-height: 132px; overflow: hidden; }
/* 控制区贴右：绝对锚定，不受左侧内容宽度影响 */
.ui-header > :deep(.game-controls),
.game-controls { position: absolute; top: 0; right: 15px; flex: 0 0 auto; }
.side-info { display: flex; gap: 10px; padding: 6px; align-items: center; background: var(--overlay-surface); backdrop-filter: blur(4px); transition: opacity 0.3s; }
.side-info.inactive { opacity: 0.4; filter: grayscale(1); }
.mini-portrait { width: 36px; height: 48px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0; }
.info-content { display: flex; flex-direction: column; width: 140px; }
.faction-name { font-size: 12px; font-weight: 900; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* [v57] 三细条行：标签 + 条 + 数值，扫读式提高面板信息密度 */
.stat-row { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
.stat-k { width: 22px; flex-shrink: 0; font-size: 9px; color: var(--color-text-secondary); font-weight: 800; letter-spacing: 1px; }
.stat-v { width: 20px; flex-shrink: 0; text-align: right; font-size: 9px; color: var(--color-text-secondary); font-family: monospace; font-weight: 800; }
.hp-bar-container { flex: 1; min-width: 0; height: 3px; background: var(--color-border); border-radius: 2px; overflow: hidden; }
.hp-bar-fill { height: 100%; transition: width 0.3s; }
.bg-cyan { background: var(--color-cyan); }
.bg-red { background: var(--color-empire); }
.bg-gold { background: var(--color-warning, #f59e0b); }
.bg-green { background: #22c55e; }
.mini-gold { color: var(--color-text-secondary); font-size: 11px; font-family: monospace; font-weight: 800; }
.text-cyan { color: var(--color-cyan); }
/* [v58] .battle-dialog-overlay 立绘对话框样式已随模板删除（banter 改走旗舰浮动气泡） */

@media (max-width: 768px) {
  .faction-infos { max-width: calc(100% - 30px); }  .side-info { width: calc(50% - 5px); }
  .info-content { width: 100%; }
  /* 回归修复：flex-direction:column 在独立锚定后已失效（两者都是 absolute，不在同一流里），
     旧版靠它把控制区挤到卡片下方。窄屏必须显式下移，否则控制区与卡片同排重叠整条宽度。
     142px = 卡片区上限 132px + 10px 间距。 */
  .ui-header > :deep(.game-controls),
  .game-controls { top: 142px; }
}
</style>