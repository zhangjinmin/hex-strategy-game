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
          <!-- [W2.3] 阵型（中文名）+ 编成摘要（P2 成果可见） -->
          <div class="mini-gold" v-if="f.active">阵型 <span class="text-cyan">{{ formationCn(f) || '—' }}</span></div>
          <div class="mini-comp" v-if="f.active && compText(f)">{{ compText(f) }}</div>
          <div class="mini-gold text-red" v-else-if="!f.active">舰队已溃散</div>
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
import { resolveAdmiralDoctrine } from '../../game/retreatDoctrine';
import GameControls from './GameControls.vue';

const store = useGameStore();

// [W2.3] P2 成果可见：faction 的教范阵型（`admiralStyleTag` 优先，回落 `admiralTags`；战役轨逐位不变）
const FORMATION_CN: Record<string, string> = {
  wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵',
};
/** 教范阵型中文名：**仅在存在 P2 信号时**给出（`admiralStyleTag`/`composition`/`admiralTags`）。
 *  战役轨 faction 三者皆无 ⇒ 返回空串（避免硬显"楔形阵"而与实际阵型不符；原 formation 站点在
 *  战役轨回落 `admiralTags` ⇒ 无标签即 wedge，但战役舰队 formation 实际来自战略数据，不可硬编）。 */
const formationCn = (f: any): string => {
  const p2Signal = !!(f?.admiralStyleTag) || !!(f?.composition) || !!(f?.admiralTags && f.admiralTags.length);
  if (!p2Signal) return '';
  const tag = f?.admiralStyleTag;
  const form = resolveAdmiralDoctrine(tag ? [tag] : f?.admiralTags).formation;
  return FORMATION_CN[form] || form;
};
/** 编成摘要（只列非零舰种）：战列N 巡洋N …；无 composition（战役轨）⇒ 空串 */
const compText = (f: any): string => {
  const c = f?.composition;
  if (!c) return '';
  const rows: [string, number][] = [
    ['战列', c.battleships], ['巡洋', c.cruisers], ['驱逐', c.destroyers],
    ['空母', c.carriers || 0], ['战机', c.fighters || 0], ['补给', c.supplies || 0],
  ];
  return rows.filter(([, n]) => n > 0).map(([k, n]) => `${k}${n}`).join(' ');
};

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
/* 舰队卡贴左，与右侧控制区**互不挤压**（两者都是绝对定位，不在同一 flex 流里）。
   横向预留右侧控制区宽度：实测 GameControls 在演习/战役两种布局下都不到 560px，
   旧预留更小时卡片排满会钻到按钮底下（1920 下实测重叠 84~199px）。
   ⚠ 这个数是**预留宽度**，不是"卡片区可用宽度"——后者由视口决定，见下一条。 */
/* [v99] **不再出现滚动条**（用户实报：窗口缩小后左上状态板冒出纵向滚动条）。
   旧实现是「固定 max-height + overflow-y:auto」—— 只要窗口变窄把卡片挤到第三行，
   高度就溢出，于是长出滚动条；在战斗界面上滚动条既丑又挡信息。
   现改为「不裁切、不滚动」：容器高度随内容自然增长，宽度到极限就换行，行多就往下铺。
   同时把卡片本身做成**可收缩**的（`.info-content` 用 clamp 随视口变窄），
   同样的宽度能多放一张卡 ⇒ 换行更晚、占的高度更少。 */
.faction-infos { position: absolute; top: 0; left: 15px; display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; pointer-events: auto; max-width: calc(100% - 560px); overflow: visible; }
/* 控制区贴右：绝对锚定，不受左侧内容宽度影响 */
.ui-header > :deep(.game-controls),
.game-controls { position: absolute; top: 0; right: 15px; flex: 0 0 auto; }
.side-info { display: flex; gap: 8px; padding: 5px 6px; align-items: center; background: var(--overlay-surface); backdrop-filter: blur(4px); transition: opacity 0.3s; }
.side-info.inactive { opacity: 0.4; filter: grayscale(1); }
.mini-portrait { width: 32px; height: 44px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0; }
/* [v99] 卡片内容宽度随视口收缩（120~168px）：窗口变窄时**先压卡片**再换行，
   避免"一缩窗就多出一行、把面板撑高"。下限 120px 是「舰况/士气/补给」+ 进度条 + 数值仍可读的最小宽度。 */
.info-content { display: flex; flex-direction: column; width: clamp(120px, 9.5vw, 168px); }
.faction-name { font-size: calc(14px * var(--font-scale)); font-weight: 900; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* [v57] 三细条行：标签 + 条 + 数值，扫读式提高面板信息密度 */
.stat-row { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
/* [v66] 标签/数值用 min-width + nowrap 而不是固定 width：
   字号放大后（尤其 fontScale×uiScale 双高时）「舰况 / 士气 / 补给」会被挤成竖排两行、把整张卡撑高。
   改成不换行 + 最小宽度，宽度不够时挤占中间的条，而不是折行。 */
.stat-k { min-width: 26px; flex-shrink: 0; white-space: nowrap; font-size: calc(11px * var(--font-scale)); color: var(--color-text-secondary); font-weight: 800; letter-spacing: 1px; }
.stat-v { min-width: 24px; flex-shrink: 0; white-space: nowrap; text-align: right; font-size: calc(11px * var(--font-scale)); color: var(--color-text-secondary); font-family: var(--font-family); font-weight: 800; }
.hp-bar-container { flex: 1; min-width: 0; height: 4px; background: var(--color-border); border-radius: 2px; overflow: hidden; }
.hp-bar-fill { height: 100%; transition: width 0.3s; }
.bg-cyan { background: var(--color-cyan); }
.bg-red { background: var(--color-empire); }
.bg-gold { background: var(--color-warning, #f59e0b); }
.bg-green { background: #22c55e; }
.mini-gold { color: var(--color-text-secondary); font-size: calc(13px * var(--font-scale)); font-family: var(--font-family); font-weight: 800; }
/* [W2.3] 编成摘要（较小，单行省略） */
.mini-comp { color: var(--color-text-disabled); font-size: calc(11px * var(--font-scale)); font-family: var(--font-family); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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