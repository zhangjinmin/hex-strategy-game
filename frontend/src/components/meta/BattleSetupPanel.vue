<template>
  <div class="tab-panel animate-fade battle-setup-container">
    <div class="setup-layout">
      <div class="env-settings neo-card">
        <h3 class="panel-title-small">作战环境参数</h3>
        
        <div class="control-group mt-2">
          <label>作战宙域 (星图)</label>
          <div class="flex gap-2">
            <div class="select-wrapper neo-btn flex-1">
              <select v-model="selectedMapId" class="neo-select">
                <option v-for="m in safeMapsPool" :key="m.id" :value="m.id">{{ m.name }} ({{ m.size }})</option>
              </select>
            </div>
            <button v-if="String(selectedMapId).startsWith('custom_')" @click="editCustomMap" class="neo-btn btn-icon text-cyan" title="重新编辑该星图">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3l9-9z"/></svg>
            </button>
            <button v-if="String(selectedMapId).startsWith('custom_')" @click="deleteCustomMap" class="neo-btn btn-icon text-red" title="删除该星图">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V2h4v2M5 4v10h6V4"/><line x1="6" y1="7" x2="10" y2="7"/><line x1="8" y1="7" x2="8" y2="11"/></svg>
            </button>
          </div>
        </div>

        <div class="control-group">
          <label>交战态势评估</label>
          <div class="select-wrapper neo-btn">
            <select v-model="selectedDiff" class="neo-select">
              <option v-for="d in diffConfig" :key="d.level" :value="d.level">{{ d.name }}</option>
            </select>
          </div>
        </div>
        
        <div class="control-group">
          <label>敌方势力选择</label>
          <div class="select-wrapper neo-btn">
            <select v-model="selectedFactionId" class="neo-select">
              <option value="all">全阵营 (随机混合)</option>
              <option value="empire">银河帝国</option>
              <option value="alliance">自由行星同盟</option>
            </select>
          </div>
          <p class="text-xs text-slate-500 mt-1 note-text">选择敌军来源势力，"全阵营"则帝国与同盟提督混合抽调。</p>
        </div>

        <div class="control-group">
          <label class="text-red">敌对势预估 ({{ activeFactionCount }} 支舰队)</label>
          <div class="select-wrapper neo-btn">
            <select v-model="activeFactionCount" class="neo-select">
              <option :value="1">遭遇战 (1支敌对舰队)</option>
              <option :value="2">局部冲突 (2支敌对舰队)</option>
              <option :value="3">标准会战 (3支敌对舰队)</option>
              <option :value="4">大规模战役 (4支敌对舰队)</option>
              <option :value="5">总力战 (5支敌对舰队)</option>
            </select>
          </div>
          <p class="text-xs text-slate-500 mt-1 note-text">注：敌军将领将由电脑随机抽调并满编。</p>
        </div>

        <!-- 地图风格选择 -->
        <div class="control-group" v-if="isSimMode">
          <label>战场制图</label>
          <div class="select-wrapper neo-btn">
            <select v-model="mapStyle" class="neo-select">
              <option value="hex">星域棋盘（经典六角格）</option>
              <option value="crt">全息战术投影（CRT复古）</option>
              <option value="3d">3D 战场（全维沙盘）</option>
              <option value="command">指挥制（纯宇宙舰队战）</option>
            </select>
          </div>
          <button @click="showShipGallery = true" class="neo-btn btn-sm w-full mt-1" style="margin-top:6px;color:#1fd28f;border-color:rgba(31,210,143,0.4)">
            ⬡ 舰艇模型巡览（一次性查看全部已导入战舰）
          </button>
        </div>
        
        <div class="launch-action">
          <button @click="launchBattle" class="btn-launch-game neo-btn active w-full" :disabled="dispatchAdmiralsList.length === 0">
            授权全舰队跃迁
          </button>
          <p class="text-red text-xs mt-1 text-center" v-if="dispatchAdmiralsList.length === 0">需指派至少一名提督</p>
        </div>
      </div>

      <div class="dispatch-board neo-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3 class="panel-title-small">前线出战序列 (最大5支舰队)</h3>
            <div style="display: flex; gap: 4px; margin-right: 15px;">
              <button @click="autoDispatch('alliance')" class="neo-btn text-cyan px-2 py-1 text-xs">同盟</button>
              <button @click="autoDispatch('empire')" class="neo-btn text-red px-2 py-1 text-xs">帝国</button>
              <button @click="autoDispatch('all')" class="neo-btn text-cyan px-2 py-1 text-xs">全势力</button>
            </div>
        </div>
        
        <div class="dispatch-grid">
          <div v-for="i in 5" :key="'dispatch-'+i" class="dispatch-slot neo-inset" @click="openDispatchSelect(i - 1)">
            <template v-if="dispatchAdmiralsList[i - 1] !== undefined">
              <img :src="getPortrait(getAdmiralInfo(dispatchAdmiralsList[i - 1])?.imageId)" class="slot-portrait" @error="handleImgError" />
              <div class="slot-info">
                <div class="slot-name-row">
                  <span class="adm-slot-name" :class="getAdmiralInfo(dispatchAdmiralsList[i - 1])?.faction === 'empire' ? 'text-red' : 'text-cyan'">{{ getAdmiralInfo(dispatchAdmiralsList[i - 1])?.name }}</span>
                  <span class="slot-rank">{{ RANK_NAMES[getAdmiralInfo(dispatchAdmiralsList[i - 1])?.rank] }}</span>
                </div>
                <div class="slot-stats">
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'command'))" :title="'统帅'">统{{ getStat(dispatchAdmiralsList[i - 1], 'command') }}</span>
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'attack'))" :title="'攻击'">攻{{ getStat(dispatchAdmiralsList[i - 1], 'attack') }}</span>
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'defense'))" :title="'防御'">防{{ getStat(dispatchAdmiralsList[i - 1], 'defense') }}</span>
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'mobility'))" :title="'机动'">机{{ getStat(dispatchAdmiralsList[i - 1], 'mobility') }}</span>
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'operations'))" :title="'营运'">营{{ getStat(dispatchAdmiralsList[i - 1], 'operations') }}</span>
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'intelligence'))" :title="'情报'">情{{ getStat(dispatchAdmiralsList[i - 1], 'intelligence') }}</span>
                  <span :class="statColor(getStat(dispatchAdmiralsList[i - 1], 'tactics'))" :title="'战术'">术{{ getStat(dispatchAdmiralsList[i - 1], 'tactics') }}</span>
                </div>
                <div class="slot-bottom">
                  <span class="slot-ships">{{ getShipCount(dispatchAdmiralsList[i - 1]) }}艘</span>
                  <span v-for="t in (getAdmiralInfo(dispatchAdmiralsList[i - 1])?.tags || []).slice(0, 2)" :key="t" class="trait-tag">{{ tagShort(t) }}</span>
                </div>
              </div>
              <span class="slot-remove" @click.stop="removeDispatch(i - 1)">×</span>
            </template>
            <span v-else class="empty-mark">+ 指派提督</span>
          </div>
        </div>
      </div>
    </div>

    <div class="selection-modal" v-if="selecting">
      <div class="modal-content neo-card roster-modal">
        <h3 class="mb-4">调度现役将领</h3>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <select v-model="tableFactionFilter" class="neo-btn neo-select" style="flex: 1; padding: 6px 10px; background: var(--neo-surface); color: var(--color-text-secondary); border: 1px solid var(--overlay-border);">
            <option value="all">全势力</option>
            <option value="empire">帝国</option>
            <option value="alliance">同盟</option>
          </select>
        </div>
        <div class="roster-table neo-inset">
          <div class="table-header roster-hdr">
            <span></span>
            <span @click="handleSort('name')" class="sortable">将领</span>
            <span @click="handleSort('rank')" class="sortable">军阶</span>
            <span @click="handleSort('ships')" class="sortable">舰船</span>
            <span @click="handleSort('command')" class="sortable" title="统帅">统</span>
            <span @click="handleSort('attack')" class="sortable" title="攻击">攻</span>
            <span @click="handleSort('defense')" class="sortable" title="防御">防</span>
            <span @click="handleSort('mobility')" class="sortable" title="机动">机</span>
            <span @click="handleSort('operations')" class="sortable" title="营运">营</span>
            <span @click="handleSort('intelligence')" class="sortable" title="情报">情</span>
            <span @click="handleSort('tactics')" class="sortable" title="战术">术</span>
            <span>特质</span>
          </div>
          <div class="roster-scroll">
            <div v-for="adm in sortedAvailableAdmirals" :key="adm.id" class="table-row neo-btn roster-row" @click="confirmDispatch(adm.id)">
              <div class="cell-portrait"><img :src="getPortrait(adm.imageId)" class="mini-portrait" @error="handleImgError"/></div>
              <div class="cell-name" :class="adm.faction === 'empire' ? 'text-red' : 'text-ally'">{{ adm.name }}</div>
              <div class="cell-rank text-xs">{{ RANK_NAMES[adm.rank] }}</div>
              <div class="text-xs text-gold">{{ getShipCount(adm.id) }}艘</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'command'))">{{ getStat(adm, 'command') }}</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'attack'))">{{ getStat(adm, 'attack') }}</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'defense'))">{{ getStat(adm, 'defense') }}</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'mobility'))">{{ getStat(adm, 'mobility') }}</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'operations'))">{{ getStat(adm, 'operations') }}</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'intelligence'))">{{ getStat(adm, 'intelligence') }}</div>
              <div class="cell-stat" :class="statColor(getStat(adm, 'tactics'))">{{ getStat(adm, 'tactics') }}</div>
              <div class="trait-cell">
                <span v-for="t in (adm.tags || []).slice(0, 2)" :key="t" class="trait-tag">{{ tagShort(t) }}</span>
                <span v-if="(adm.tags || []).length > 2" class="trait-more">+{{ adm.tags.length - 2 }}</span>
              </div>
            </div>
            <div v-if="sortedAvailableAdmirals.length === 0" class="text-center text-slate-500 p-6 font-bold">无可用将领。</div>
          </div>
        </div>
        <button class="neo-btn text-red w-full mt-4 py-2" @click="selecting = false">取消</button>
      </div>
    </div>

    <!-- 舰艇模型巡览浮层（QA 工具） -->
    <ShipGalleryOverlay v-if="showShipGallery" @close="showShipGallery = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore, RANK_NAMES, getPortrait } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { totalShips } from '../../types/game';
import { diffConfig } from '../../config/gameData';
import { TAG_META_MAP } from '../../config/tagConfig';
import ShipGalleryOverlay from '../battle/ShipGalleryOverlay.vue';

const store = useGameStore();

/** 舰艇模型巡览浮层开关 */
const showShipGallery = ref(false);

// 辅助函数
const statColor = (v: number) => v >= 85 ? 'stat-s' : v >= 70 ? 'stat-a' : v >= 50 ? 'stat-b' : 'stat-c';
const getStat = (adm: any, key: string) => {
  const eff = typeof adm === 'number' ? getEffective(adm) : getEffective(adm.id);
  return eff?.[key] ?? adm.stats?.[key] ?? '-';
};
const getTotal = (adm: any) => {
  const s = adm.stats || {};
  return (s.command || 0) + (s.operations || 0) + (s.intelligence || 0) + (s.mobility || 0) + (s.attack || 0) + (s.defense || 0) + (s.tactics || 0);
};
const tagShort = (t: string) => (TAG_META_MAP as any)[t]?.label?.slice(0, 3) || t;
const settings = useSettingsStore();

const safeAllAdmirals = computed<any[]>(() => {
  const raw = (store as any).allAdmirals;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const isSimMode = computed<boolean>(() => {
  const raw = (store as any).simMode;
  return raw?.value !== undefined ? raw.value : raw;
});

const mapStyle = ref<'hex' | 'crt' | '3d' | 'command'>((() => {
  const raw = (settings as any).battlefieldMode;
  return (raw?.value !== undefined ? raw.value : raw) ?? 'command';
})());

const safeMapsPool = computed<any[]>(() => {
  const raw = (store as any).mapsPool;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const dispatchAdmiralsList = computed<number[]>(() => {
  if (isSimMode.value) {
    const raw = (store as any).simSelectedAdmirals;
    return raw?.value !== undefined ? raw.value : (raw || []);
  }
  const raw = (store as any).dispatchAdmirals;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const updateDispatchList = (arr: number[]) => {
  if (isSimMode.value) {
    (store as any).simSelectedAdmirals = arr;
  } else {
    (store as any).dispatchAdmirals = arr;
  }
};

const selectedMapId = computed({
  get: () => { const r = (store as any).selectedMapId; return r?.value !== undefined ? r.value : r; },
  set: (v) => { (store as any).selectedMapId = v; }
});

const selectedDiff = computed({
  get: () => { const r = (store as any).selectedDiff; return r?.value !== undefined ? r.value : r; },
  set: (v) => { (store as any).selectedDiff = v; }
});

const selectedFactionId = computed({
  get: () => {
    if (isSimMode.value) {
      const r = (store as any).simFactionId;
      return r?.value !== undefined ? r.value : (r || 'all');
    }
    const r = (store as any).selectedFactionId;
    return r?.value !== undefined ? r.value : r;
  },
  set: (v) => { 
    if (isSimMode.value) {
      (store as any).simFactionId = v;
      (store as any).simSelectedAdmirals = []; // 切换敌军势力时清空已选
    } else {
      (store as any).selectedFactionId = v; 
      (store as any).dispatchAdmirals = []; 
    }
  }
});

const activeFactionCount = computed({
  get: () => {
    if (isSimMode.value) {
      const r = (store as any).simActiveFactionCount;
      return r?.value !== undefined ? r.value : (r || 1);
    }
    const r = (store as any).activeFactionCount;
    return r?.value !== undefined ? r.value : r;
  },
  set: (v) => {
    if (isSimMode.value) {
      (store as any).simActiveFactionCount = v;
    } else {
      (store as any).activeFactionCount = v;
    }
  }
});

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40"><rect width="32" height="40" fill="%231e293b"/></svg>';
};

const getAdmiralInfo = (id: number) => safeAllAdmirals.value.find((a: any) => a.id === id);
const getEffective = (id: number) => {
  if (typeof (store as any).getEffectiveStats === 'function') return (store as any).getEffectiveStats(id);
  return null;
};
const getSimFullComp = (rankName: string) => {
  const rankMap: Record<string, number> = {
    '准尉': 1, '少尉': 2, '中尉': 3, '上尉': 4,
    '少校': 5, '中校': 6, '上校': 7,
    '准将': 8, '少将': 9, '中将': 10, '上将': 11, '一级上将': 12, '元帅': 13,
  };
  const rank = rankMap[rankName] || 9;
  if (typeof (store as any).generateSimFullComposition === 'function') {
    return (store as any).generateSimFullComposition(rank);
  }
  // 兜底算法
  const total = typeof (store as any).getShipLimit === 'function' ? (store as any).getShipLimit(rank) : 5000;
  return { battleships: Math.floor(total * 0.25), fastBattleships: Math.floor(total * 0.1), cruisers: Math.floor(total * 0.25), destroyers: Math.floor(total * 0.25), carriers: Math.floor(total * 0.05), fighters: Math.floor(total * 0.05), supplies: Math.max(1, Math.floor(total * 0.05)) };
};
const getSimShipTotal = (rankName: string) => {
  const comp = getSimFullComp(rankName);
  return totalShips(comp);
};
const getShipCount = (id: number) => {
  if (isSimMode.value) {
    const adm = safeAllAdmirals.value.find((a: any) => a.id === id);
    if (!adm) return 0;
    return getSimShipTotal(adm.rankName || '少将');
  }
  const adm = safeAllAdmirals.value.find((a: any) => a.id === id);
  if (!adm) return 0;
  return adm.deck ? adm.deck.filter(Boolean).length : 0;
};

const editCustomMap = () => {
  if (typeof (store as any).openMapForEdit === 'function') (store as any).openMapForEdit(selectedMapId.value);
};

const deleteCustomMap = () => {
  if (confirm("统合作战本部提示：确定要永久销毁此战区星图数据吗？")) {
    if (typeof (store as any).deleteMap === 'function') (store as any).deleteMap(selectedMapId.value);
  }
};

const selecting = ref(false);
const activeSlotIndex = ref(-1);
const sortKey = ref('command'); 
const sortOrder = ref(-1);
const tableFactionFilter = ref('all'); // 提督表格势力筛选

const handleSort = (key: string) => {
  if (sortKey.value === key) {
    sortOrder.value *= -1;
  } else {
    sortKey.value = key;
    sortOrder.value = (key === 'name' || key === 'rank') ? 1 : -1;
  }
};

const availableForDispatch = computed(() => {
  let list = safeAllAdmirals.value;
  if (isSimMode.value) {
    // 战术模拟：显示所有准将以上提督（跨阵营）
    list = list.filter((a: any) => {
      const rankMap: Record<string, number> = {
        '准尉': 1, '少尉': 2, '中尉': 3, '上尉': 4,
        '少校': 5, '中校': 6, '上校': 7,
        '准将': 8, '少将': 9, '中将': 10, '上将': 11, '一级上将': 12, '元帅': 13,
      };
      const rank = rankMap[a.rankName] || 0;
      return rank >= 8 && !dispatchAdmiralsList.value.includes(a.id);
    });
  } else {
    list = list.filter((a: any) => 
      a.faction === selectedFactionId.value &&
      a.rank >= 8 && 
      !dispatchAdmiralsList.value.includes(a.id)
    );
  }
  // 表格内势力筛选
  if (tableFactionFilter.value !== 'all') {
    list = list.filter((a: any) => a.faction === tableFactionFilter.value);
  }
  return list;
});

const sortedAvailableAdmirals = computed(() => {
  let list = [...availableForDispatch.value];
  return list.sort((a, b) => {
    let valA, valB;
    const statKeys = ['command', 'attack', 'defense', 'mobility', 'operations', 'intelligence', 'tactics'];
    if (sortKey.value === 'ships') {
      valA = getShipCount(a.id); valB = getShipCount(b.id);
    } else if (sortKey.value === 'total') {
      valA = getTotal(a); valB = getTotal(b);
    } else if (sortKey.value === 'rank') {
      const rk: Record<string, number> = { '准尉':1,'少尉':2,'中尉':3,'上尉':4,'少校':5,'中校':6,'上校':7,'准将':8,'少将':9,'中将':10,'上将':11,'一级上将':12,'元帅':13 };
      valA = rk[RANK_NAMES[a.rank]] || 0; valB = rk[RANK_NAMES[b.rank]] || 0;
    } else if (statKeys.includes(sortKey.value)) {
      valA = getEffective(a.id)?.[sortKey.value] || a.stats?.[sortKey.value] || 0;
      valB = getEffective(b.id)?.[sortKey.value] || b.stats?.[sortKey.value] || 0;
    } else {
      valA = a[sortKey.value]; valB = b[sortKey.value];
    }
    if (valA === valB) return 0;
    return valA > valB ? sortOrder.value : -sortOrder.value;
  });
});

const openDispatchSelect = (idx: number) => { selecting.value = true; activeSlotIndex.value = idx; };

const removeDispatch = (idx: number) => {
  if (isSimMode.value) {
    const raw = (store as any).simSelectedAdmirals;
    const arr = raw?.value !== undefined ? raw.value : raw;
    arr.splice(idx, 1);
  } else {
    const raw = (store as any).dispatchAdmirals;
    const arr = raw?.value !== undefined ? raw.value : raw;
    arr.splice(idx, 1);
  }
};

const confirmDispatch = (id: number) => {
  const list = isSimMode.value ? (store as any).simSelectedAdmirals : (store as any).dispatchAdmirals;
  const arr = (list?.value !== undefined ? list.value : list) as number[];
  
  if (arr.length > activeSlotIndex.value) {
    arr[activeSlotIndex.value] = id;
  } else {
    arr.push(id);
  }
  selecting.value = false;
};

const autoDispatch = (faction: string) => {
  const list = isSimMode.value ? (store as any).simSelectedAdmirals : (store as any).dispatchAdmirals;
  const arr = (list?.value !== undefined ? list.value : list) as number[];
  
  // 先清空旧选择，支持多次点击轮换阵容
  arr.length = 0;
  
  // 直接从全提督池筛选举（绕过 computed 的异步重置延迟）
  let candidates = safeAllAdmirals.value.filter((a: any) => {
    const rankMap: Record<string, number> = {
      '准尉': 1, '少尉': 2, '中尉': 3, '上尉': 4,
      '少校': 5, '中校': 6, '上校': 7,
      '准将': 8, '少将': 9, '中将': 10, '上将': 11, '一级上将': 12, '元帅': 13,
    };
    const rank = rankMap[a.rankName] || 0;
    return rank >= 8;
  });
  
  if (faction !== 'all') {
    candidates = candidates.filter((a: any) => a.faction === faction);
  }
  // 随机洗牌，每次点击得到不同阵容
  candidates.sort(() => Math.random() - 0.5);
  
  for (const c of candidates) {
    if (arr.length >= 5) break;
    arr.push(c.id);
  }
};

const launchBattle = () => {
  if (dispatchAdmiralsList.value.length === 0) {
    if (typeof (store as any).triggerToast === 'function') (store as any).triggerToast("必须指派至少一名提督出战");
    return;
  }
  if (isSimMode.value) {
    if (typeof (store as any).launchSimBattle === 'function') (store as any).launchSimBattle(mapStyle.value);
  } else {
    if (typeof (store as any).startMatchLaunch === 'function') (store as any).startMatchLaunch();
  }
};
</script>

<style scoped>
.battle-setup-container { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.setup-layout { display: flex; gap: 15px; flex: 1; overflow: hidden; padding: 5px; min-height: 0; }

.env-settings { width: clamp(260px, 25vw, 360px); display: flex; flex-direction: column; padding: clamp(12px, 2vh, 25px); gap: clamp(10px, 1.5vh, 15px); flex-shrink: 0; overflow: hidden; }
.dispatch-board { flex: 1; padding: clamp(12px, 2vh, 25px); display: flex; flex-direction: column; overflow: hidden; min-height: 0; gap: clamp(10px, 2vh, 20px); }

.panel-title-small { font-size: clamp(13px, 1.8vh, 15px); font-weight: 800; border-left: 4px solid var(--color-cyan); padding-left: 10px; margin: 0; flex-shrink: 0; }
.control-group { display: flex; flex-direction: column; gap: clamp(4px, 1vh, 8px); flex-shrink: 0; }
.control-group label { font-size: clamp(11px, 1.5vh, 13px); font-weight: 800; color: var(--color-text-secondary); }
.note-text { font-size: clamp(10px, 1.2vh, 12px); margin: 0; }

.flex { display: flex; align-items: center; }
.gap-2 { gap: 8px; }
.flex-1 { flex: 1; }
.btn-icon { display: flex; align-items: center; justify-content: center; width: clamp(32px, 4vh, 40px); height: clamp(32px, 4vh, 40px); font-size: 14px; flex-shrink: 0; padding: 0; border: 1px solid var(--overlay-border); }

.select-wrapper { position: relative; display: flex; align-items: center; padding: 0; }
.select-wrapper::after { content: '▼'; position: absolute; right: 10px; color: var(--color-cyan); pointer-events: none; font-size: 12px; }
.neo-select { width: 100%; appearance: none; background: transparent; border: none; color: var(--color-text-primary); padding: clamp(6px, 1.2vh, 12px) clamp(8px, 1vw, 12px); font-size: clamp(11px, 1.5vh, 14px); font-weight: 800; outline: none; cursor: pointer; }
.neo-select option { background: var(--neo-surface); color: var(--color-text-secondary); }

.launch-action { margin-top: auto; flex-shrink: 0; display: flex; flex-direction: column; }
.btn-launch-game { padding: clamp(10px, 1.8vh, 16px) 10px; font-size: clamp(13px, 2vh, 16px); letter-spacing: 2px; }

.dispatch-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; overflow-y: auto; flex: 1; min-height: 0; align-content: start; padding-right: 2px; }
.dispatch-slot { display: flex; flex-direction: row; align-items: flex-start; padding: 10px; position: relative; cursor: pointer; border: 1px solid transparent; transition: border 0.2s; gap: 10px; overflow: hidden; min-height: 70px; }
.dispatch-slot:hover { border-color: var(--color-cyan); }
.slot-portrait { width: 44px; height: 55px; object-fit: cover; border-radius: 4px; background: var(--neo-surface); border: 1px solid rgba(6,182,212,0.4); flex-shrink: 0; }
.slot-info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; flex: 1; min-width: 0; gap: 4px; }
.slot-name-row { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; }
.adm-slot-name { font-size: 13px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slot-rank { font-size: 10px; color: var(--color-text-disabled); white-space: nowrap; flex-shrink: 0; }
.slot-stats { display: flex; flex-wrap: wrap; gap: 2px 6px; }
.slot-stats span { font-size: 10px; font-family: monospace; font-weight: 700; color: var(--color-text-secondary); white-space: nowrap; }
.slot-bottom { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }
.slot-ships { font-size: 10px; color: var(--color-warning); font-weight: 800; white-space: nowrap; }
.empty-mark { color: var(--color-border-emphasized); font-weight: 800; font-size: clamp(12px, 1.6vh, 14px); margin: auto; }
.slot-remove { position: absolute; top: 2px; right: 4px; color: var(--color-empire); font-weight: 800; font-size: 16px; display: none; }
.dispatch-slot:hover .slot-remove { display: block; }

.selection-modal { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--overlay-scrim); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.modal-content { width: 560px; max-height: 80vh; display: flex; flex-direction: column; padding: 25px; }

.sortable { cursor: pointer; transition: color 0.2s; user-select: none; }
.sortable:hover { color: var(--color-cyan); }
.roster-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 5px; }

/* 自适应名册表格 */
.roster-modal { width: 95vw; max-width: 1200px; }
.roster-table { display: flex; flex-direction: column; flex: 1; overflow: hidden; padding: 8px; }
.roster-hdr, .roster-row {
  display: grid;
  grid-template-columns: 38px 2fr 0.8fr 0.8fr repeat(7, 0.5fr) 1fr;
  gap: 2px;
  align-items: center;
  text-align: center;
  min-width: 0;
}
.roster-hdr {
  position: sticky; top: 0; z-index: 1;
  background: var(--neo-surface);
  border-bottom: 1px solid var(--overlay-border);
  padding: 6px 4px;
}
.roster-hdr span {
  display: flex; justify-content: center; align-items: center;
  font-size: 11px; font-weight: 800; color: var(--color-text-disabled);
}
.roster-row {
  cursor: pointer; padding: 4px; min-height: 34px; font-size: 13px;
}
.roster-row > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.roster-row .cell-name { text-align: left; padding-left: 4px; }
.roster-row .cell-portrait { text-align: left; }
.cell-name { font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 8px; }
.cell-rank { font-size: 12px; color: var(--color-text-secondary); }
.cell-stat { font-family: monospace; font-weight: 800; }
.trait-cell { display: flex; flex-wrap: nowrap; gap: 3px; align-items: center; justify-content: center; overflow: hidden; }
.trait-tag { display: inline-block; padding: 0 4px; font-size: 9px; color: #a78bfa; background: rgba(139,92,246,0.12); border-radius: 2px; white-space: nowrap; }
.trait-more { font-size: 8px; color: var(--color-text-disabled); }
.stat-s { color: #fbbf24 !important; }
.stat-a { color: #34d399 !important; }
.stat-b { color: #94a3b8 !important; }
.stat-c { color: #64748b !important; }
.text-xs { font-size: 10px; }
.text-muted { color: var(--color-text-disabled); }
.mini-portrait { width: 32px; height: 40px; border-radius: 4px; object-fit: cover; border: 1px solid var(--overlay-border); background-color: var(--neo-surface-raised); }

@media (max-width: 768px) {
  .setup-layout { flex-direction: column; gap: 10px; padding: 0; overflow: hidden; min-height: 0; }
  .env-settings { width: 100%; flex: 0 0 auto; padding: 15px; gap: 8px; }
  .dispatch-board { padding: 10px 15px; flex: 1; min-height: 0; overflow: hidden; gap: 10px; }
  .dispatch-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .dispatch-slot { min-height: 50px; padding: 6px; }
  .launch-action { margin-top: 10px; }
  
  .modal-content { width: 95vw; padding: 15px; }
  .roster-hdr, .roster-row { font-size: 11px; padding: 4px; }
  .roster-hdr span { font-size: 9px; }
  .mini-portrait { width: 24px; height: 30px; }
}
</style>