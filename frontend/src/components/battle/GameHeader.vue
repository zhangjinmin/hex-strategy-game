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
            <div class="hp-bar-container"><div class="hp-bar-fill" :class="f.team === 1 ? 'bg-cyan' : 'bg-red'" :style="{ width: hpPct(f) + '%' }"></div></div>
            <span class="stat-v">{{ Math.round(hpPct(f)) }}</span>
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
            编制 <span class="text-cyan">{{ f.unitCount }}<template v-if="getShipLimit(f.rank) > 0">/{{ getShipLimit(f.rank) }}</template></span>
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

/** [v108 修] 舰况百分比。
 *  病灶：`BattleScene` 每帧写的是 **`f.hp = Σu.hp`（绝对耐久和）** 与 `f.maxHp = Σu.maxHp`
 *    （见 `store.factions.forEach` 那段镜像），而本面板直接 `clampPct(f.hp)` 当百分比用
 *    ⇒ 绝对值 12,000 被夹到 100 ⇒ **打到快灭团，舰况条仍是满的**（用户实报）。
 *  正确口径：有 maxHp 时取比值；没有时（尚未镜像/旧存档）退回按百分比解释。 */
const hpPct = (f: any): number => {
  const max = Number(f?.maxHp) || 0;
  const cur = Number(f?.hp) || 0;
  if (max <= 0) return clampPct(cur);
  const ratio = (cur / max) * 100;
  /* 两种口径都可能出现在镜像里：
       · cur/max 都是绝对值（正常路径）⇒ ratio 就是百分比；
       · cur 已是百分比、而 max 仍是绝对值（历史写入）⇒ ratio 会畸小（<1）。
     判据取"ratio<1 且 cur 落在 0..100" ⇒ 按百分比解释。
     ⚠ 这是**兜底**，不是根治：真正的单位归属由 `[W3.7 舰队快照]` 里新加的
       `factionHp=/fleetΣ=` 两个读数确认（见 BattleScene.collectFleetSnapshot）。 */
  if (ratio < 1 && cur > 0 && cur <= 100) return clampPct(cur);
  return clampPct(ratio);
};

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40"><rect width="32" height="40" fill="%231e293b"/></svg>';
};
</script>

<style scoped>
/* 两侧独立绝对锚定，卡片再多也不会把右侧控制区推出视口（沿用既有修复） */
.ui-header { position: absolute; top: var(--ui-3); left: 0; right: 0; z-index: 10; pointer-events: none; }
/* 右侧控制区预留宽度随按钮放大同步扩到 640px；卡片区不裁切、不滚动 */
.faction-infos {
  position: absolute; top: 0; left: var(--ui-3);
  display: flex; align-items: flex-start; gap: var(--ui-2); flex-wrap: wrap;
  pointer-events: auto; max-width: calc(100% - 640px); overflow: visible;
}
.ui-header > :deep(.game-controls),
.game-controls { position: absolute; top: 0; right: var(--ui-3); flex: 0 0 auto; }
.side-info {
  display: flex; gap: var(--ui-2); padding: var(--ui-1) var(--ui-2); align-items: center;
  background: var(--ui-panel); border: var(--ui-frame); border-radius: var(--ui-radius);
  box-shadow: var(--ui-shadow-raised); backdrop-filter: blur(8px);
  transition: opacity var(--ui-dur-normal);
}
.side-info.inactive { opacity: 0.4; filter: grayscale(1); }
.mini-portrait {
  width: 48px; height: 64px; object-fit: cover; border-radius: 0;
  border: 1px solid var(--ui-line-strong); flex-shrink: 0;
}
/* 卡片内容宽度下限从 120 提到 168：字号上阶梯后仍能单行显示「舰况/士气/补给」 */
.info-content { display: flex; flex-direction: column; width: clamp(168px, 12vw, 232px); }
.faction-name {
  font-family: var(--ui-display-font); font-size: var(--fs-body); font-weight: 800;
  margin-bottom: var(--ui-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: 0.04em;
}
.stat-row { display: flex; align-items: center; gap: var(--ui-1); margin-bottom: 3px; }
.stat-k { min-width: 36px; flex-shrink: 0; white-space: nowrap; font-size: var(--fs-caption); color: var(--ui-ink-2); font-weight: 800; }
.stat-v { min-width: 32px; flex-shrink: 0; white-space: nowrap; text-align: right; font-size: var(--fs-caption); color: var(--ui-ink-2); font-weight: 800; font-variant-numeric: tabular-nums; }
.hp-bar-container { flex: 1; min-width: 0; height: 8px; background: var(--ui-surface-3); border: 1px solid var(--ui-line); overflow: hidden; }
.hp-bar-fill { height: 100%; transition: width var(--ui-dur-normal) var(--ui-ease); }
.bg-cyan { background: var(--ui-accent); }
.bg-red { background: var(--side-foe); }
.bg-gold { background: var(--dmc-warning); }
.bg-green { background: var(--dmc-success); }
.mini-gold { color: var(--ui-ink-2); font-size: var(--fs-caption); font-weight: 800; font-variant-numeric: tabular-nums; }
.mini-comp { color: var(--ui-ink-3); font-size: var(--fs-caption); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text-cyan { color: var(--ui-accent); }

@media (max-width: 768px) {
  .faction-infos { max-width: calc(100% - 30px); }  .side-info { width: calc(50% - 5px); }
  .info-content { width: 100%; }
  /* 卡片变高后控制区下移量同步增大，避免窄屏同排重叠 */
  .ui-header > :deep(.game-controls),
  .game-controls { top: 186px; }
}
</style>