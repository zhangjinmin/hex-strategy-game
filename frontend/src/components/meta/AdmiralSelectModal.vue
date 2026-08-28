<template>
  <div class="selection-modal">
    <div class="modal-content neo-card">
      <div class="flex-header">
        <h3 class="text-gold m-0">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" style="vertical-align:-3px;margin-right:4px;"><path d="M8 1l1.8 3.6 4 .6-2.9 2.8.7 4L8 10.2 4.4 12l.7-4-2.9-2.8 4-.6L8 1z"/></svg>
          选择你的提督
        </h3>
        <button class="neo-btn text-red px-4" @click="$emit('cancel')">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>
      </div>

      <p class="select-desc">宇宙历 796 年，自由行星同盟与银河帝国的战争进入关键阶段。你将扮演哪位指挥官？</p>

      <!-- 阵营切换 -->
      <div class="faction-switch">
        <button @click="activeFaction = 'alliance'" class="neo-btn faction-btn"
          :class="{ active: activeFaction === 'alliance', 'faction-ally': activeFaction === 'alliance' }">
          <img :src="allianceFlag" class="faction-flag" alt="同盟" />
          <div class="faction-titles">
            <span class="faction-label">自由行星同盟</span>
            <span class="faction-count">{{ allianceCount }}名提督</span>
          </div>
        </button>
        <button @click="activeFaction = 'empire'" class="neo-btn faction-btn"
          :class="{ active: activeFaction === 'empire', 'faction-emp': activeFaction === 'empire' }">
          <img :src="empireFlag" class="faction-flag" alt="帝国" />
          <div class="faction-titles">
            <span class="faction-label">银河帝国</span>
            <span class="faction-count">{{ empireCount }}名提督</span>
          </div>
        </button>
      </div>

      <!-- 搜索 -->
      <div class="search-bar">
        <span class="search-icon"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="4.5"/><line x1="10" y1="10" x2="14" y2="14"/></svg></span>
        <input type="text" v-model="searchKeyword" placeholder="搜索提督姓名 / 旗舰..." class="neo-input" />
        <span class="sort-hint" v-if="sortKey">排序: {{ sortLabel }}</span>
      </div>

      <!-- 提督表格 -->
      <div class="table-wrapper">
        <table class="admiral-table">
          <thead>
            <tr>
              <th class="col-select"></th>
              <th class="col-portrait"></th>
              <th @click="sortBy('name')" class="sortable col-name">姓名
                <svg v-if="sortKey==='name'" viewBox="0 0 8 12" width="8" height="12" fill="currentColor" style="margin-left:3px;vertical-align:-1px;">
                  <path v-if="sortOrder==='asc'" d="M4 0L0 4h8L4 0z"/>
                  <path v-else d="M4 12L0 8h8l-4 4z"/>
                </svg>
              </th>
              <th @click="sortBy('rankName')" class="sortable col-rank">军阶</th>
              <th class="col-flagship">旗舰</th>
              <th @click="sortBy('stats.command')" class="sortable num-col">统</th>
              <th @click="sortBy('stats.operations')" class="sortable num-col">营</th>
              <th @click="sortBy('stats.intelligence')" class="sortable num-col">情</th>
              <th @click="sortBy('stats.mobility')" class="sortable num-col">机</th>
              <th @click="sortBy('stats.attack')" class="sortable num-col">攻</th>
              <th @click="sortBy('stats.defense')" class="sortable num-col">防</th>
              <th @click="sortBy('stats.tactics')" class="sortable num-col">术</th>
              <th class="col-traits">特质</th>
              <th @click="sortBy('total')" class="sortable num-col col-total">总和</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="adm in sortedAdmirals" :key="adm.id"
              class="admiral-row"
              :class="{ selected: selectedId === adm.id }"
              @click="selectedId = adm.id">
              <td class="col-select"><span class="radio-dot" :class="{ checked: selectedId === adm.id }"></span></td>
              <td class="col-portrait"><img :src="getPortrait(adm.imageId)" class="row-portrait" @error="handleImgError" /></td>
              <td class="col-name"><span :class="adm.faction === 'alliance' ? 'text-cyan' : 'text-red'">{{ adm.name }}</span></td>
              <td class="col-rank"><span class="rank-badge">{{ adm.rankName }}</span></td>
              <td class="col-flagship text-muted">{{ adm.flagshipName || '—' }}</td>
              <td class="num-col" :class="statClass(adm.stats.command)">{{ adm.stats.command }}</td>
              <td class="num-col" :class="statClass(adm.stats.operations)">{{ adm.stats.operations }}</td>
              <td class="num-col" :class="statClass(adm.stats.intelligence)">{{ adm.stats.intelligence }}</td>
              <td class="num-col" :class="statClass(adm.stats.mobility)">{{ adm.stats.mobility }}</td>
              <td class="num-col" :class="statClass(adm.stats.attack)">{{ adm.stats.attack }}</td>
              <td class="num-col" :class="statClass(adm.stats.defense)">{{ adm.stats.defense }}</td>
              <td class="num-col" :class="statClass(adm.stats.tactics)">{{ adm.stats.tactics }}</td>
              <td class="col-traits">
                <span v-for="tag in (adm.tags || []).slice(0, 3)" :key="tag" class="trait-tag">{{ tagName(tag) }}</span>
              </td>
              <td class="num-col col-total"><span class="total-badge">{{ calcTotal(adm) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 底部：已选提督详情 + 确认 -->
      <div class="action-row">
        <div class="selected-info" v-if="selectedAdmiral">
          <div class="selected-card">
            <img :src="getPortrait(selectedAdmiral.imageId)" class="selected-portrait" @error="handleImgError" />
            <div class="selected-details">
              <div class="selected-name">
                <span :class="selectedAdmiral.faction === 'alliance' ? 'text-cyan' : 'text-red'">{{ selectedAdmiral.name }}</span>
                <span class="selected-rank">{{ selectedAdmiral.rankName }}</span>
              </div>
              <div class="selected-meta">
                <span>旗舰: {{ selectedAdmiral.flagshipName || '未配置' }}</span>
                <span v-if="selectedAdmiral.skills?.length">特技: {{ selectedAdmiral.skills.map((s:any)=>s.name).join(' / ') }}</span>
              </div>
              <div class="selected-hidden" v-if="selectedAdmiral.hiddenStats">
                <span class="hidden-stat">
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:3px;"><path d="M8 14s6-4.5 6-7-3-5-6-5-6 2.5-6 5 6 7 6 7z"/><circle cx="8" cy="7" r="2"/></svg>
                  忠 {{ selectedAdmiral.hiddenStats.loyalty ?? selectedAdmiral.loyalty ?? '?' }}
                </span>
                <span class="hidden-stat">
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:3px;"><path d="M8 1v6l3-1.5"/><path d="M8 7l-3-1.5"/><line x1="8" y1="1" x2="8" y2="7"/></svg>
                  野 {{ selectedAdmiral.hiddenStats.ambition ?? '?' }}
                </span>
                <span class="hidden-stat">
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-1px;margin-right:3px;"><line x1="2" y1="2" x2="14" y2="14"/><path d="M6 2h8v8"/></svg>
                  义 {{ selectedAdmiral.hiddenStats.righteousness ?? '?' }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="selected-info text-muted" v-else>请点击表格中的提督行进行选择</div>
        <button class="neo-btn btn-confirm text-emerald" :disabled="!selectedId" @click="confirmSelect">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><polyline points="2,8 6,12 14,4"/></svg>
          确认就任
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import { TAG_META_MAP } from '../../config/tagConfig';
import allianceFlag from '../../assets/flag/alliance.png';
import empireFlag from '../../assets/flag/empire.png';

const store = useGameStore();
const emit = defineEmits(['confirm', 'cancel']);

const activeFaction = ref<'alliance' | 'empire'>('alliance');
const selectedId = ref<number | null>(null);
const searchKeyword = ref('');
const sortKey = ref<string>('total');
const sortOrder = ref<'asc' | 'desc'>('desc');

const rankOrder: Record<string, number> = {
  '准尉': 1, '少尉': 2, '中尉': 3, '上尉': 4,
  '少校': 5, '中校': 6, '上校': 7,
  '准将': 8, '少将': 9, '中将': 10, '上将': 11, '元帅': 12,
  '宰相': 13, '议会': 14
};

const tagName = (t: string) => (TAG_META_MAP as any)[t]?.label || t;
const sortLabel = computed(() => {
  const map: Record<string, string> = {
    'name': '姓名', 'rankName': '军阶', 'total': '总和',
    'stats.command': '统帅', 'stats.operations': '营运', 'stats.intelligence': '情报',
    'stats.mobility': '机动', 'stats.attack': '攻击', 'stats.defense': '防御', 'stats.tactics': '战术'
  };
  return map[sortKey.value] || sortKey.value;
});

const statClass = (v: number) => v >= 85 ? 'stat-s' : v >= 70 ? 'stat-a' : v >= 50 ? 'stat-b' : 'stat-c';

const allAdmirals = computed(() => {
  const raw = (store as any).allAdmirals;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const calcTotal = (adm: any): number => {
  const s = adm.stats;
  return s.command + s.operations + s.intelligence + s.mobility + s.attack + s.defense + s.tactics;
};

const filteredAdmirals = computed(() => {
  return allAdmirals.value.filter((a: any) => {
    if (a.faction !== activeFaction.value) return false;
    if ((rankOrder[a.rankName] || 0) < 9) return false;
    // 排除不可扮演角色：皇帝(181)、最高评议会(165)
    if (a.role === 'emperor' || a.role === 'council' || a.id === 181 || a.id === 165) return false;
    if (searchKeyword.value.trim()) {
      const kw = searchKeyword.value.toLowerCase().trim();
      if (!a.name.toLowerCase().includes(kw) && !(a.flagshipName || '').toLowerCase().includes(kw)) return false;
    }
    return true;
  });
});

const countByFaction = (faction: string) => {
  return allAdmirals.value.filter((a: any) => {
    if (a.faction !== faction) return false;
    if ((rankOrder[a.rankName] || 0) < 9) return false;
    if (a.role === 'emperor' || a.role === 'council' || a.id === 181 || a.id === 165) return false;
    return true;
  }).length;
};
const allianceCount = computed(() => countByFaction('alliance'));
const empireCount = computed(() => countByFaction('empire'));

const getNestedValue = (obj: any, path: string) => path.split('.').reduce((o, k) => (o ? o[k] : 0), obj);

const sortedAdmirals = computed(() => {
  const list = [...filteredAdmirals.value];
  const key = sortKey.value;
  const order = sortOrder.value === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    let valA, valB;
    if (key === 'total') { valA = calcTotal(a); valB = calcTotal(b); }
    else if (key === 'rankName') { valA = rankOrder[a.rankName] || 0; valB = rankOrder[b.rankName] || 0; }
    else { valA = getNestedValue(a, key); valB = getNestedValue(b, key); }
    if (typeof valA === 'string') return valA.localeCompare(valB, 'zh-CN') * order;
    return (valA - valB) * order;
  });
  return list;
});

const sortBy = (key: string) => {
  sortOrder.value = sortKey.value === key ? (sortOrder.value === 'asc' ? 'desc' : 'asc') : 'desc';
  sortKey.value = key;
};

const selectedAdmiral = computed(() => {
  if (selectedId.value === null) return null;
  return allAdmirals.value.find((a: any) => a.id === selectedId.value) || null;
});

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="%231e293b"/><text x="20" y="30" text-anchor="middle" fill="%2394a3b8" font-size="14">?</text></svg>';
};

const confirmSelect = () => {
  if (selectedId.value !== null) emit('confirm', selectedId.value);
};
</script>

<style scoped>
.selection-modal {
  position: fixed; inset: 0;
  background: var(--overlay-scrim); z-index: 3000;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(8px);
}
.modal-content {
  width: 1200px; max-width: 97vw; max-height: 92vh;
  display: flex; flex-direction: column; padding: 28px; gap: 14px;
}
.flex-header { display: flex; justify-content: space-between; align-items: center; }
.m-0 { margin: 0; font-size: 22px; font-weight: 900; }
.px-4 { padding: 8px 16px; }

.select-desc { font-size: 13px; color: var(--color-text-secondary); margin: 0; line-height: 1.5; }

/* 阵营按钮 */
.faction-switch { display: flex; gap: 12px; }
.faction-btn {
  flex: 1; padding: 12px 16px;
  display: flex; flex-direction: row; align-items: center; justify-content: flex-start; gap: 12px;
  font-size: 13px; font-weight: 700;
  background: var(--overlay-surface); border: 2px solid var(--overlay-hover);
  transition: all 0.25s; cursor: pointer; text-align: left;
}
.faction-btn.active { border-color: var(--color-cyan); background: rgba(6,182,212,0.08); }
.faction-btn.faction-emp.active { border-color: var(--color-empire); background: rgba(239,68,68,0.08); }
.faction-flag { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; border: 1px solid var(--overlay-border); flex-shrink: 0; }
.faction-titles { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.faction-label { font-size: 15px; font-weight: 900; }
.faction-count { font-size: 11px; color: var(--color-text-disabled); }

/* 搜索 */
.search-bar { display: flex; align-items: center; gap: 8px; padding: 0; }
.search-icon { font-size: 14px; opacity: 0.5; }
.neo-input {
  flex: 1; padding: 9px 14px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(6,182,212,0.25);
  color: var(--color-text-primary); font-size: 13px; font-weight: 600;
  border-radius: 6px; outline: none; transition: border 0.2s;
}
.neo-input:focus { border-color: var(--color-cyan); }
.sort-hint { font-size: 11px; color: var(--color-text-disabled); white-space: nowrap; }

/* 表格 */
.table-wrapper {
  flex: 1; overflow: auto; border-radius: 8px;
  border: 1px solid var(--overlay-hover);
}
.admiral-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.admiral-table thead { position: sticky; top: 0; z-index: 10; background: var(--neo-surface); }
.admiral-table th {
  padding: 10px 5px; font-weight: 800; color: var(--color-text-secondary);
  border-bottom: 2px solid rgba(6,182,212,0.25); white-space: nowrap; user-select: none;
}
.admiral-table th.sortable { cursor: pointer; }
.admiral-table th.sortable:hover { color: var(--color-cyan); background: rgba(6,182,212,0.06); }
.sort-arrow { font-size: 10px; color: var(--color-warning); margin-left: 2px; }
.admiral-table td { padding: 4px 5px; border-bottom: 1px solid rgba(255,255,255,0.03); white-space: nowrap; }
.admiral-row { cursor: pointer; transition: background 0.12s; }
.admiral-row:hover { background: rgba(6,182,212,0.05); }
.admiral-row.selected { background: rgba(16,185,129,0.1); }
.admiral-row.selected td { border-bottom-color: rgba(16,185,129,0.2); }

.col-select { width: 30px; text-align: center; }
.col-portrait { width: 44px; text-align: center; }
.col-name { min-width: 75px; font-weight: 800; }
.col-rank { min-width: 52px; }
.col-flagship { min-width: 72px; font-size: 11px; }
.num-col { text-align: center; font-family: 'Courier New', monospace; font-weight: 700; width: 30px; font-size: 11px; }
.col-traits { min-width: 80px; }
.col-total { width: 42px; }

.row-portrait { width: 34px; height: 42px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); vertical-align: middle; }

.radio-dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--color-border-emphasized); background: transparent; transition: all 0.2s; }
.radio-dot.checked { border-color: var(--color-green); background: var(--color-green); box-shadow: 0 0 6px rgba(16,185,129,0.5); }

.rank-badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; color: var(--color-warning); background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.2); }
.total-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 900; color: var(--color-cyan); background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.2); }

.trait-tag { display: inline-block; padding: 1px 5px; margin: 1px; border-radius: 3px; font-size: 9px; font-weight: 700; color: #a78bfa; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.2); white-space: nowrap; }

/* 属性高亮 */
.stat-s { color: #fbbf24 !important; }  /* 85+ 金色 */
.stat-a { color: #34d399 !important; }  /* 70+ 绿色 */
.stat-b { color: #94a3b8 !important; }  /* 50+ 灰色 */
.stat-c { color: #64748b !important; }  /* <50 暗灰 */

/* 已选详情卡片 */
.action-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding-top: 14px; border-top: 1px solid var(--overlay-hover); flex-shrink: 0; }
.selected-info { flex: 1; }
.selected-card { display: flex; gap: 12px; align-items: center; }
.selected-portrait { width: 48px; height: 60px; object-fit: cover; border-radius: 6px; border: 2px solid var(--color-warning); }
.selected-details { display: flex; flex-direction: column; gap: 4px; }
.selected-name { display: flex; gap: 8px; align-items: baseline; font-weight: 900; font-size: 15px; }
.selected-rank { font-size: 11px; color: var(--color-warning); }
.selected-meta { font-size: 12px; color: var(--color-text-secondary); display: flex; gap: 12px; }
.selected-hidden { font-size: 11px; color: var(--color-text-disabled); display: flex; gap: 14px; }
.hidden-stat { opacity: 0.7; }

.btn-confirm { padding: 14px 36px; font-size: 15px; font-weight: 900; flex-shrink: 0; }
.btn-confirm:disabled { opacity: 0.35; cursor: not-allowed; }

.text-cyan { color: var(--color-cyan) !important; }
.text-red { color: var(--color-empire) !important; }
.text-muted { color: var(--color-text-disabled); }
.text-gold { color: var(--color-warning); }
.text-emerald { color: var(--color-green) !important; }
</style>
