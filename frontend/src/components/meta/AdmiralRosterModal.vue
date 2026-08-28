<template>
  <div class="roster-overlay" @click.self="$emit('close')">
    <div class="roster-modal neo-card">
      <div class="modal-header">
        <h3 class="modal-title">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:6px;"><circle cx="8" cy="4" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>
          提督名册 · 只读
        </h3>
        <button class="neo-btn text-slate-400 px-2" @click="$emit('close')">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>

      <div class="roster-layout">
        <!-- 阵营切换 -->
        <div class="faction-tabs">
          <button @click="currentFaction = 'empire'; selectedAdmiral = null" class="neo-btn tab-btn" :class="{active: currentFaction === 'empire'}">银河帝国</button>
          <button @click="currentFaction = 'alliance'; selectedAdmiral = null" class="neo-btn tab-btn" :class="{active: currentFaction === 'alliance'}">自由同盟</button>
        </div>

        <!-- 左：全人物表格 -->
        <div class="roster-panel">
          <div class="roster-header">
            <span class="col-port"></span>
            <span @click="sortBy('name')" class="col-name sortable">名 {{ sortArrow('name') }}</span>
            <span @click="sortBy('rank')" class="col-rank sortable">军阶 {{ sortArrow('rank') }}</span>
            <span @click="sortBy('role')" class="col-role sortable">职 {{ sortArrow('role') }}</span>
            <span @click="sortStat('command')" class="col-stat sortable">统 {{ sortArrow('stats.command') }}</span>
            <span @click="sortStat('operations')" class="col-stat sortable">营 {{ sortArrow('stats.operations') }}</span>
            <span @click="sortStat('intelligence')" class="col-stat sortable">知 {{ sortArrow('stats.intelligence') }}</span>
            <span @click="sortStat('mobility')" class="col-stat sortable">机 {{ sortArrow('stats.mobility') }}</span>
            <span @click="sortStat('attack')" class="col-stat sortable">攻 {{ sortArrow('stats.attack') }}</span>
            <span @click="sortStat('defense')" class="col-stat sortable">防 {{ sortArrow('stats.defense') }}</span>
            <span @click="sortStat('tactics')" class="col-stat sortable">策 {{ sortArrow('stats.tactics') }}</span>
          </div>
          <div class="roster-body">
            <div v-for="adm in sortedAdmirals" :key="adm.id" class="roster-row"
                 :class="{ active: selectedAdmiral?.id === adm.id }"
                 @click="selectAdmiral(adm)">
              <div class="col-port"><img :src="getPortrait(adm.imageId)" class="mini-portrait" @error="handleImgError"/></div>
              <div class="col-name" :class="adm.faction === 'empire' ? 'text-red' : 'text-ally'">{{ adm.name }}</div>
              <div class="col-rank">{{ RANK_NAMES[adm.rank] }}</div>
              <div class="col-role">{{ roleAbbr[adm.role] || '—' }}</div>
              <div class="col-stat">{{ adm.stats?.command ?? 0 }}</div>
              <div class="col-stat">{{ adm.stats?.operations ?? 0 }}</div>
              <div class="col-stat">{{ adm.stats?.intelligence ?? 0 }}</div>
              <div class="col-stat">{{ adm.stats?.mobility ?? 0 }}</div>
              <div class="col-stat">{{ adm.stats?.attack ?? 0 }}</div>
              <div class="col-stat">{{ adm.stats?.defense ?? 0 }}</div>
              <div class="col-stat">{{ adm.stats?.tactics ?? 0 }}</div>
            </div>
          </div>
        </div>

        <!-- 右：人物详情 -->
        <div class="admiral-detail" v-if="selectedAdmiral">
          <div class="detail-scroll">
            <img :src="getPortrait(selectedAdmiral.imageId)" class="large-portrait" @error="handleImgError"/>
            <h2 :class="currentFaction === 'empire' ? 'text-red' : 'text-ally'">{{ selectedAdmiral.name }}</h2>
            <div class="rank-badge">{{ RANK_NAMES[selectedAdmiral.rank] }}</div>
            <div v-if="selectedAdmiral.flagshipName" class="detail-line">旗舰：{{ selectedAdmiral.flagshipName }}</div>
            <div v-if="selectedAdmiral.role && selectedAdmiral.role !== 'none'" class="detail-line">职务：{{ roleDict[selectedAdmiral.role] || selectedAdmiral.role }}</div>

            <div class="effective-stats">
              <div v-for="(val, key) in detailStats" :key="key" class="stat-row">
                <span class="stat-label">{{ statLabels[key] }}</span>
                <div class="stat-track">
                  <div class="stat-fill" :style="{ width: Math.min(100, (val / 100) * 100) + '%' }"></div>
                </div>
                <span class="stat-val">{{ val }}</span>
              </div>
            </div>

            <div v-if="selectedAdmiral.tags?.length" class="mt-3">
              <div class="sub-title">人物标签</div>
              <div class="tag-wrap">
                <span v-for="tag in selectedAdmiral.tags" :key="tag" class="tag-chip">{{ getTagLabel(tag) }}</span>
              </div>
            </div>

            <div class="mt-3">
              <div class="sub-title">所属舰队</div>
              <div v-if="fleetOfAdmiral" class="detail-line">第{{ fleetOfAdmiral.fleetNumber || fleetOfAdmiral.id }}舰队 · {{ formationName(fleetOfAdmiral.formation) }}</div>
              <div v-else class="detail-line muted">未编入舰队</div>
            </div>
          </div>
        </div>
        <div class="admiral-detail empty-detail" v-else>← 点击左侧将领查看详情</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore, RANK_NAMES, getPortrait } from '../../store/gameStore';
import { TAG_META_MAP } from '../../config/tagConfig';
import { FORMATIONS } from '../../config/formations';
import type { AdmiralTag } from '../../types/game';

const emit = defineEmits<{ close: [] }>();
const store = useGameStore() as any;

const safeAllAdmirals = computed<any[]>(() => {
  const raw = store.allAdmirals;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40"><rect width="32" height="40" fill="%231e293b"/></svg>';
};

const currentFaction = ref<'empire' | 'alliance'>('empire');
const selectedAdmiral = ref<any>(null);

const sortKey = ref('rank');
const sortAsc = ref(false);
const sortBy = (key: string) => {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else { sortKey.value = key; sortAsc.value = false; }
};
const sortStat = (key: string) => sortBy(`stats.${key}`);
const sortArrow = (key: string) => (sortKey.value === key ? (sortAsc.value ? '↑' : '↓') : '');

const roleAbbr: Record<string, string> = {
  emperor: '帝', prime_minister: '相', military_minister: '军', high_command_chief: '统',
  space_fleet_commander: '司', space_fleet_deputy: '副', council: '议',
  joint_ops_chief: '本', joint_ops_deputy: '次', intel_minister: '情',
  defense_commander: '防', fleet_commander: '队', fleet_staff: '参', none: '',
};
const roleDict: Record<string, string> = {
  emperor: '帝国皇帝', prime_minister: '帝国宰相', military_minister: '军务尚书', high_command_chief: '统帅本部总长',
  space_fleet_commander: '宇宙舰队司令', space_fleet_deputy: '舰队副司令', council: '评议会议长',
  joint_ops_chief: '统合本部长', joint_ops_deputy: '统合本部次长', fleet_commander: '舰队司令官', none: '无职务'
};
const statLabels: Record<string, string> = {
  command: '统帅', operations: '营运', intelligence: '情报', mobility: '机动',
  attack: '攻击', defense: '防御', tactics: '军师'
};

const factionAdmirals = computed(() => safeAllAdmirals.value.filter((a: any) => a.faction === currentFaction.value));
const detailStats = computed<Record<string, number>>(() => {
  if (typeof store.getEffectiveStats === 'function') return store.getEffectiveStats(selectedAdmiral.value?.id) || selectedAdmiral.value?.stats || {};
  return selectedAdmiral.value?.stats || {};
});

const sortedAdmirals = computed(() => {
  const list = [...factionAdmirals.value];
  return list.sort((a: any, b: any) => {
    let valA: any, valB: any;
    const key = sortKey.value;
    if (key.startsWith('stats.')) {
      valA = a.stats?.[key.replace('stats.', '')] ?? 0;
      valB = b.stats?.[key.replace('stats.', '')] ?? 0;
    } else if (key === 'role') {
      valA = a.role || 'none'; valB = b.role || 'none';
      if (valA < valB) return sortAsc.value ? -1 : 1;
      if (valA > valB) return sortAsc.value ? 1 : -1;
      return 0;
    } else { valA = a[key] ?? 0; valB = b[key] ?? 0; }
    if (valA === valB) return 0;
    return valA > valB ? (sortAsc.value ? 1 : -1) : (sortAsc.value ? -1 : 1);
  });
});

const getTagLabel = (tag: AdmiralTag): string => TAG_META_MAP[tag]?.label || tag;
const selectAdmiral = (adm: any) => { selectedAdmiral.value = adm; };

const fleetOfAdmiral = computed(() => {
  const fleets = store.strategicFleets?.value || store.strategicFleets || [];
  return fleets.find((f: any) => f.commanderId === selectedAdmiral.value?.id) || null;
});
const formationName = (fid: string): string => FORMATIONS[fid as keyof typeof FORMATIONS]?.name || '';
</script>

<style scoped>
.roster-overlay { position: fixed; inset: 0; z-index: 1250; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
.roster-modal { width: 96vw; height: 92vh; display: flex; flex-direction: column; padding: 14px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.modal-title { font-size: 15px; font-weight: 800; color: var(--color-cyan); margin: 0; }
.roster-layout { flex: 1; display: flex; flex-direction: row; gap: 12px; min-height: 0; }
.faction-tabs { display: flex; flex-direction: column; gap: 6px; width: 90px; flex-shrink: 0; }
.tab-btn { padding: 8px 6px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); font-size: 12px; cursor: pointer; border-radius: 3px; }
.tab-btn.active { border-color: var(--color-cyan); color: var(--color-cyan); background: rgba(6,182,212,0.08); }
.roster-panel { flex: 3; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.roster-header, .roster-row { display: grid; grid-template-columns: 34px 90px 64px 32px repeat(7, 34px); align-items: center; gap: 2px; font-size: 10px; }
.roster-header { padding: 4px 6px; border-bottom: 1px solid var(--color-border); color: var(--color-text-disabled); }
.sortable { cursor: pointer; user-select: none; }
.roster-header .sortable:hover { color: var(--color-cyan); }
.roster-body { flex: 1; overflow-y: auto; }
.roster-row { padding: 3px 6px; cursor: pointer; color: var(--color-text-secondary); }
.roster-row:hover, .roster-row.active { background: rgba(6,182,212,0.08); color: var(--color-text-primary); }
.mini-portrait { width: 26px; height: 34px; object-fit: cover; border-radius: 2px; display: block; }
.text-red { color: #ef4444; } .text-ally { color: #38bdf8; }

.admiral-detail { flex: 2; border: 1px solid var(--color-border); border-radius: 4px; padding: 14px; overflow: hidden; min-width: 260px; display: flex; flex-direction: column; }
.empty-detail { display: flex; align-items: center; justify-content: center; color: var(--color-text-disabled); font-size: 12px; }
.detail-scroll { display: flex; flex-direction: column; height: 100%; overflow-y: auto; }
.large-portrait { width: 110px; height: 145px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); }
.detail-scroll h2 { margin: 8px 0 2px; font-size: 19px; }
.rank-badge { display: inline-block; font-size: 11px; color: var(--color-gold); border: 1px solid var(--color-gold); padding: 1px 8px; border-radius: 10px; margin-bottom: 4px; }
.detail-line { font-size: 12px; color: var(--color-text-primary); margin-top: 4px; }
.detail-line.muted { color: var(--color-text-disabled); }
.effective-stats { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.stat-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.stat-label { width: 34px; color: var(--color-text-disabled); }
.stat-track { flex: 1; height: 7px; background: rgba(148,163,184,0.12); border-radius: 3px; overflow: hidden; }
.stat-fill { height: 100%; background: linear-gradient(90deg, #06b6d4, #22d3ee); border-radius: 3px; }
.stat-val { width: 30px; text-align: right; font-weight: 800; color: var(--color-text-primary); }
.mt-3 { margin-top: 12px; }
.sub-title { font-size: 11px; font-weight: 700; color: var(--color-text-disabled); margin-bottom: 4px; }
.tag-wrap { display: flex; flex-wrap: wrap; gap: 4px; }
.tag-chip { font-size: 10px; padding: 2px 6px; background: rgba(245,158,11,0.1); color: #f59e0b; border-radius: 8px; }
</style>
