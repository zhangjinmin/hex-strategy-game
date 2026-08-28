<template>
  <div class="selection-modal">
    <div class="modal-content neo-card">
      <div class="flex-header mb-4">
        <h3 class="text-gold m-0">战术电脑：存档系统</h3>
        <button class="neo-btn text-red px-4" @click="emit('close')">X</button>
      </div>

      <!-- 三标签页切换 -->
      <div class="tab-bar">
        <button class="tab-btn" :class="{ active: activeTab === 'new' }" @click="activeTab = 'new'">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v14M1 8h14"/><rect x="2" y="2" width="12" height="12" rx="2"/></svg></span> 新开档案
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'continue' }" @click="activeTab = 'continue'">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="4,2 14,8 4,14"/></svg></span> 继续档案
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'manage' }" @click="activeTab = 'manage'">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1.5 5.5l2.6 1.5M11.9 9l2.6 1.5M1.5 10.5l2.6-1.5M11.9 7l2.6-1.5"/></svg></span> 管理档案
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          <span class="tab-icon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="14" height="9" rx="1"/><line x1="1" y1="7" x2="15" y2="7"/><circle cx="4" cy="10.5" r="0.8" fill="currentColor" stroke="none"/></svg></span> 系统设置
        </button>
      </div>

      <!-- ========== 标签页：新开档案 ========== -->
      <div v-if="activeTab === 'new'" class="tab-panel tab-new">
        <p class="panel-desc">创建一个新的游戏档案，选择你扮演的提督身份开始征程。</p>

        <!-- 档案名称输入 -->
        <div class="form-row name-row">
          <label>档案名称</label>
          <input v-model="newSaveName" class="neo-input" placeholder="例如：杨威利·第一次征途（可选）" maxlength="20"
                 style="flex:1; padding:10px 14px; font-size:13px;" />
        </div>

        <!-- 阵营切换 -->
        <div class="faction-switch">
          <button @click="activeFaction = 'alliance'" class="neo-btn faction-btn"
                  :class="{active: activeFaction === 'alliance', 'text-ally': activeFaction === 'alliance'}">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:4px;"><polygon points="8,1 14,5 14,11 8,15 2,11 2,5"/></svg> 自由行星同盟 ({{ allianceCount }})
          </button>
          <button @click="activeFaction = 'empire'" class="neo-btn faction-btn"
                  :class="{active: activeFaction === 'empire', 'text-red': activeFaction === 'empire'}">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:4px;"><path d="M8 2l3 4h2l-3 5 2 3H4l2-3-3-5h2z"/></svg> 银河帝国 ({{ empireCount }})
          </button>
        </div>

        <!-- 搜索框 -->
        <div class="search-bar">
          <input type="text" v-model="searchKeyword" placeholder="搜索姓名 / 旗舰..." class="neo-input" />
        </div>

        <!-- 提督表格 -->
        <div class="table-wrapper">
          <table class="admiral-table">
            <thead>
              <tr>
                <th class="col-select"></th>
                <th class="col-portrait">立绘</th>
                <th @click="sortBy('name')" class="col-name sortable">
                  姓名 <span class="sort-arrow" v-if="sortKey === 'name'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('rankName')" class="col-rank sortable">
                  军阶 <span class="sort-arrow" v-if="sortKey === 'rankName'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th class="col-flagship">旗舰</th>
                <th @click="sortBy('stats.command')" class="sortable num-col">
                  统帅 <span class="sort-arrow" v-if="sortKey === 'stats.command'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('stats.operations')" class="sortable num-col">
                  营运 <span class="sort-arrow" v-if="sortKey === 'stats.operations'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('stats.intelligence')" class="sortable num-col">
                  情报 <span class="sort-arrow" v-if="sortKey === 'stats.intelligence'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('stats.mobility')" class="sortable num-col">
                  机动 <span class="sort-arrow" v-if="sortKey === 'stats.mobility'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('stats.attack')" class="sortable num-col">
                  攻击 <span class="sort-arrow" v-if="sortKey === 'stats.attack'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('stats.defense')" class="sortable num-col">
                  防御 <span class="sort-arrow" v-if="sortKey === 'stats.defense'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('stats.tactics')" class="sortable num-col">
                  战术 <span class="sort-arrow" v-if="sortKey === 'stats.tactics'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
                <th @click="sortBy('total')" class="sortable num-col col-total">
                  总和 <span class="sort-arrow" v-if="sortKey === 'total'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="adm in sortedAdmirals" :key="adm.id"
                  class="admiral-row" :class="{ selected: selectedAdmiralId === adm.id }"
                  @click="selectedAdmiralId = adm.id">
                <td class="col-select"><span class="radio-dot" :class="{ checked: selectedAdmiralId === adm.id }"></span></td>
                <td class="col-portrait"><img :src="getPortrait(adm.imageId)" class="row-portrait" @error="handleImgError" /></td>
                <td class="col-name"><span :class="adm.faction === 'alliance' ? 'text-cyan' : 'text-red'">{{ adm.name }}</span></td>
                <td class="col-rank"><span class="rank-badge">{{ adm.rankName }}</span></td>
                <td class="col-flagship text-slate-400">{{ adm.flagshipName || '—' }}</td>
                <td class="num-col">{{ adm.stats?.command ?? 0 }}</td>
                <td class="num-col">{{ adm.stats?.operations ?? 0 }}</td>
                <td class="num-col">{{ adm.stats?.intelligence ?? 0 }}</td>
                <td class="num-col">{{ adm.stats?.mobility ?? 0 }}</td>
                <td class="num-col">{{ adm.stats?.attack ?? 0 }}</td>
                <td class="num-col">{{ adm.stats?.defense ?? 0 }}</td>
                <td class="num-col">{{ adm.stats?.tactics ?? 0 }}</td>
                <td class="num-col col-total"><span class="total-badge">{{ calcTotal(adm) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 已选信息 + 开始按钮 -->
        <div class="action-row new-action">
          <div class="selected-info" v-if="selectedAdmiralObj">
            已选择:
            <span :class="selectedAdmiralObj.faction === 'alliance' ? 'text-cyan' : 'text-red'" style="font-weight:900;">
              {{ selectedAdmiralObj.name }}
            </span>
            ({{ selectedAdmiralObj.rankName }}) — 旗舰 {{ selectedAdmiralObj.flagshipName || '未配置' }}
            <span class="faction-mini" :class="selectedAdmiralObj.faction === 'alliance' ? 'ally-tag' : 'empire-tag'">
              {{ selectedAdmiralObj.faction === 'alliance' ? '自由行星同盟' : '银河帝国' }}
            </span>
          </div>
          <div class="selected-info text-slate-500" v-else>点击表格行选择扮演的提督</div>
          <button class="neo-btn btn-primary" :disabled="selectedAdmiralId < 0" @click="handleNewGame">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px;margin-right:4px;"><path d="M8 1l1.8 3.6 4 .6-2.9 2.8.7 4L8 10.2 4.4 12l.7-4-2.9-2.8 4-.6L8 1z"/></svg> 开始新的征程
          </button>
        </div>
      </div>

      <!-- ========== 标签页：继续档案 ========== -->
      <div v-if="activeTab === 'continue'" class="tab-panel">
        <div v-if="userSlots.length === 0" class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 16 16" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><path d="M2 3h4l2 2h6v8H2V3z"/></svg></div>
          <p>尚无任何档案</p>
          <p class="empty-hint">请先在「新开档案」中创建一个新游戏。</p>
        </div>
        <div v-else class="list-container">
          <div v-for="slot in sortedUserSlots" :key="slot.id"
               class="save-slot neo-inset slot-clickable" @click="handleLoad(slot.id)">
            <div class="slot-info">
              <div class="slot-name">{{ slot.name }}</div>
              <div class="slot-meta">
                <span class="slot-admiral" :class="slot.factionClass">{{ slot.admiralName }}</span>
                <span class="slot-date">宇宙历 {{ slot.universeDate }}</span>
                <span class="slot-time">{{ formatTime(slot.timestamp) }}</span>
              </div>
            </div>
            <div class="slot-arrow"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><polygon points="4,2 12,8 4,14"/></svg></div>
          </div>
        </div>
      </div>

      <!-- ========== 标签页：管理档案 ========== -->
      <div v-if="activeTab === 'manage'" class="tab-panel">
        <div class="manage-header" v-if="userSlots.length > 0">
          <span class="manage-count">共 {{ userSlots.length }} 个档案（不含自动存档）</span>
        </div>
        <div v-if="allSlotsList.length === 0" class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 16 16" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><path d="M2 3h4l2 2h6v8H2V3z"/></svg></div>
          <p>暂无任何存档数据</p>
        </div>
        <div v-else class="list-container">
          <div v-for="slot in allSlotsList" :key="slot.id"
               class="save-slot neo-inset" :class="{ 'slot-autosave': slot.isAutosave }">
            <div class="slot-info">
              <div class="slot-name">
                {{ slot.name }}
                <span v-if="slot.isAutosave" class="autosave-tag">自动</span>
              </div>
              <div class="slot-meta">
                <span class="slot-admiral" :class="slot.factionClass">{{ slot.admiralName }}</span>
                <span class="slot-date">宇宙历 {{ slot.universeDate }}</span>
                <span class="slot-time">{{ formatTime(slot.timestamp) }}</span>
              </div>
            </div>
            <div class="slot-actions-manage">
              <button class="neo-btn text-emerald" v-if="!slot.isAutosave"
                      @click="handleOverwrite(slot.id)" title="覆盖保存当前进度到此档案">覆盖</button>
              <button class="neo-btn text-red" :disabled="slot.isAutosave"
                      @click="handleDelete(slot.id)" title="删除此档案">删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== 标签页：系统设置 ========== -->
      <div v-if="activeTab === 'settings'" class="tab-panel tab-settings">
        <SettingsPanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import SettingsPanel from './SettingsPanel.vue';

const store = useGameStore();
const emit = defineEmits(['close']);
const props = defineProps<{ initialTab?: string }>();

// ====== 标签页切换 ======
type TabType = 'new' | 'continue' | 'manage' | 'settings';
const activeTab = ref<TabType>((props.initialTab as TabType) || 'new');

// ====== 新开档案：表单状态 ======
const newSaveName = ref('');
const selectedAdmiralId = ref<number>(-1);

// ====== 新开档案：提督表格逻辑 ======
const activeFaction = ref<'alliance' | 'empire'>('alliance');
const searchKeyword = ref('');
const sortKey = ref<string>('rankName');
const sortOrder = ref<'asc' | 'desc'>('desc');

/** 军阶排序权重 */
const rankOrder: Record<string, number> = {
  '准尉': 1, '少尉': 2, '中尉': 3, '上尉': 4,
  '少校': 5, '中校': 6, '上校': 7,
  '准将': 8, '少将': 9, '中将': 10, '上将': 11, '元帅': 12,
  '宰相': 13, '议会': 14
};

const allAdmiralsRaw = computed(() => {
  const raw = (store as any).allAdmirals;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

/** 各阵营可选拥督数量（少将及以上） */
const allianceCount = computed(() =>
  allAdmiralsRaw.value.filter((a: any) => a.faction === 'alliance' && (rankOrder[a.rankName] || 0) >= 9).length
);
const empireCount = computed(() =>
  allAdmiralsRaw.value.filter((a: any) => a.faction === 'empire' && (rankOrder[a.rankName] || 0) >= 9).length
);

/** 计算属性总和 */
const calcTotal = (adm: any): number => {
  const s = adm.stats;
  if (!s) return 0;
  return (s.command || 0) + (s.operations || 0) + (s.intelligence || 0) +
         (s.mobility || 0) + (s.attack || 0) + (s.defense || 0) + (s.tactics || 0);
};

/** 筛选：少将及以上 + 阵营 + 搜索 */
const filteredAdmirals = computed(() => {
  return allAdmiralsRaw.value.filter((a: any) => {
    // 阵营匹配（使用字符串 'alliance' / 'empire'）
    if (a.faction !== activeFaction.value) return false;
    // 少将及以上
    if ((rankOrder[a.rankName] || 0) < 9) return false;
    // 搜索关键字
    if (searchKeyword.value.trim()) {
      const kw = searchKeyword.value.toLowerCase().trim();
      const nameMatch = (a.name || '').toLowerCase().includes(kw);
      const shipMatch = (a.flagshipName || '').toLowerCase().includes(kw);
      if (!nameMatch && !shipMatch) return false;
    }
    return true;
  });
});

/** 深层取值 */
const getNestedValue = (obj: any, path: string): any => {
  return path.split('.').reduce((o, k) => (o ? o[k] : 0), obj);
};

/** 排序后列表 */
const sortedAdmirals = computed(() => {
  const list = [...filteredAdmirals.value];
  const key = sortKey.value;
  const order = sortOrder.value === 'asc' ? 1 : -1;

  list.sort((a: any, b: any) => {
    let valA: any, valB: any;
    if (key === 'total') { valA = calcTotal(a); valB = calcTotal(b); }
    else if (key === 'rankName') { valA = rankOrder[a.rankName] || 0; valB = rankOrder[b.rankName] || 0; }
    else { valA = getNestedValue(a, key); valB = getNestedValue(b, key); }
    if (typeof valA === 'string' && typeof valB === 'string') return valA.localeCompare(valB, 'zh-CN') * order;
    return (valA - valB) * order;
  });

  return list;
});

/** 点击表头排序 */
const sortBy = (key: string) => {
  if (sortKey.value === key) { sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'; }
  else { sortKey.value = key; sortOrder.value = 'desc'; }
};

/** 已选提督对象 */
const selectedAdmiralObj = computed(() => {
  if (selectedAdmiralId.value === null || selectedAdmiralId.value < 0) return null;
  return allAdmiralsRaw.value.find((a: any) => a.id === selectedAdmiralId.value) || null;
});

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="%231e293b"/><text x="20" y="30" text-anchor="middle" fill="%2394a3b8" font-size="14">?</text></svg>';
};

// ====== 槽位列表计算 ======
const allAdmsRaw = computed(() => {
  const raw = (store as any).allAdmirals;
  return raw?.value !== undefined ? raw.value : (raw || []);
});

const buildSlotMeta = (id: string, slotData: any) => {
  const data = slotData.data || {};
  const meta = slotData.meta || {};
  const admiralId = data.playerAdmiralId ?? -1;
  const adm = allAdmsRaw.value.find((a: any) => a.id === admiralId);
  const admiralName = meta.admiralName || (adm ? `${adm.rankName} ${adm.name}` : '未知提督');
  const faction = meta.admiralFaction || adm?.faction || 'alliance';
  return {
    admiralName,
    universeDate: meta.universeDate || data.universeDate || '796.01.01',
    factionClass: faction === 'empire' ? 'text-red' : 'text-cyan',
  };
};

const userSlots = computed(() => {
  const slots = store.saveSlots as any;
  if (!slots) return [];
  return Object.entries(slots)
    .filter(([id]) => id !== 'autosave')
    .map(([id, data]: [string, any]) => ({
      id, name: data.name || '未命名档案',
      timestamp: data.timestamp || 0, isAutosave: false, data: data.data,
      ...buildSlotMeta(id, data),
    }));
});

const sortedUserSlots = computed(() => [...userSlots.value].sort((a, b) => b.timestamp - a.timestamp));

const allSlotsList = computed(() => {
  const slots = store.saveSlots as any;
  if (!slots) return [];
  return Object.entries(slots)
    .map(([id, data]: [string, any]) => ({
      id,
      name: data.name || (id === 'autosave' ? '战略自动存档' : '未命名档案'),
      timestamp: data.timestamp || 0, isAutosave: id === 'autosave', data: data.data,
      ...buildSlotMeta(id, data),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
});

// ====== 操作方法 ======

const handleNewGame = async () => {
  if (selectedAdmiralId.value < 0) return;
  const slotId = `slot_${Date.now()}`;
  const saveName = newSaveName.value.trim() || `档案_${userSlots.value.length + 1}`;

  // 【核心修复】：在确认新游戏前，强制调用 store 的重置方法或刷新静态数据
  // 避免使用上一次读档残留在内存里的提督数据
  if (typeof (store as any).restartGame === 'function') {
    (store as any).restartGame();
  }

  // confirmAdmiralSelect 内部已设置 playerAdmiralId + gameState = 'strategy' + autoSave
  if (typeof (store as any).confirmAdmiralSelect === 'function') {
    (store as any).confirmAdmiralSelect(selectedAdmiralId.value);
  }

  // 创建新槽位并保存（独立于 autosave）
  await store.createNewSlot(slotId, saveName);

  // 关闭弹窗
  emit('close');
};

const handleLoad = async (id: string) => {
  if (confirm("确定要读取该档案吗？当前未保存的进度将会丢失。")) {
    await store.loadFromSlot(id);
    emit('close');
  }
};

const handleOverwrite = async (id: string) => {
  const slot = (store.saveSlots as any)?.[id];
  const name = slot?.name || id;
  if (confirm(`确定要覆盖档案「${name}」吗？当前进度将写入此位置。`)) await store.saveToSlot(id, name);
};

const handleDelete = async (id: string) => {
  const slot = (store.saveSlots as any)?.[id];
  const name = slot?.name || id;
  if (confirm(`确定要销毁档案「${name}」吗？此操作不可撤销！`)) await store.deleteSlot(id);
};

// ====== 辅助函数 ======

const getAdmiralName = (slot: any): string => {
  const data = slot.data;
  if (!data?.playerAdmiralId && data?.playerAdmiralId !== 0) return '未知提督';
  const adm = (store.allAdmirals as any)?.find((a: any) => a.id === data.playerAdmiralId);
  return adm ? `${adm.rankName} ${adm.name}` : '未知提督';
};

const formatTime = (ts: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
</script>

<style scoped>
/* ===== 弹窗容器 ===== */
.selection-modal { position: fixed; inset: 0; background: var(--overlay-scrim); z-index: 2000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); }
.modal-content { width: 1020px; max-width: 96vw; max-height: 88vh; display: flex; flex-direction: column; padding: 22px; gap: 10px; }
.flex-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--overlay-hover); padding-bottom: 12px; }
.m-0 { margin: 0; font-size: 20px; font-weight: 900; }
.mb-4 { margin-bottom: 10px; }
.px-4 { padding-left: 15px; padding-right: 15px; }

/* ===== 标签栏 ===== */
.tab-bar { display: flex; gap: 4px; background: var(--neo-body); border-radius: 10px; padding: 4px; flex-shrink: 0; }
.tab-btn {
  flex: 1; padding: 9px 16px; font-size: 14px; font-weight: 800; color: var(--color-text-disabled);
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.tab-btn:hover { color: var(--color-text-secondary); background: var(--overlay-hover); }
.tab-btn.active { color: var(--color-text-primary); background: var(--neo-surface-raised); box-shadow: inset 0 2px 4px rgba(0,0,0,0.3); }
.tab-icon { font-size: 16px; }

/* ===== 各面板通用 ===== */
.tab-panel { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; flex: 1; min-height: 0; padding: 2px; }
.tab-new { min-height: 520px; }
.panel-desc { font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; margin: 0; }

/* ===== 表单行 ===== */
.form-row { display: flex; align-items: center; gap: 12px; }
.form-row label { font-size: 13px; font-weight: 800; color: var(--color-text-secondary); padding-left: 6px; white-space: nowrap; border-left: 3px solid var(--color-cyan); }
.neo-input {
  width: 100%; padding: 10px 14px; font-size: 13px; font-weight: 600; color: var(--color-text-primary);
  background: var(--neo-surface); border: 1px solid var(--color-border); border-radius: 8px; outline: none; transition: border-color 0.2s;
}
.neo-input:focus { border-color: var(--color-cyan); box-shadow: 0 0 0 3px rgba(6,182,212,0.15); }
.neo-input::placeholder { color: var(--color-border-emphasized); }

/* ===== 阵营切换 ===== */
.faction-switch { display: flex; gap: 10px; }
.faction-btn { flex: 1; padding: 9px; font-size: 13px; font-weight: 800; }

/* ===== 搜索栏 ===== */
.search-bar { padding: 0; }

/* ===== 提督表格（与 AdmiralSelectModal 一致）===== */
.table-wrapper { flex: 1; overflow: auto; border-radius: 8px; border: 1px solid var(--overlay-hover); min-height: 0; }
.admiral-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'Segoe UI', sans-serif; }
.admiral-table thead { position: sticky; top: 0; z-index: 10; background: var(--neo-surface); }
.admiral-table th {
  padding: 8px 5px; font-weight: 800; color: var(--color-text-secondary);
  border-bottom: 2px solid rgba(6, 182, 212, 0.3);
  white-space: nowrap; cursor: default; user-select: none;
}
.admiral-table th.sortable { cursor: pointer; }
.admiral-table th.sortable:hover { color: var(--color-cyan); background: rgba(6,182,212,0.05); }
.sort-arrow { font-size: 10px; color: var(--color-warning); margin-left: 2px; }
.admiral-table td { padding: 5px; border-bottom: 1px solid rgba(255,255,255,0.04); white-space: nowrap; }
.admiral-row { cursor: pointer; transition: background 0.15s; }
.admiral-row:hover { background: rgba(6, 182, 212, 0.06); }
.admiral-row.selected { background: rgba(16, 185, 129, 0.12); }
.admiral-row.selected td { border-bottom-color: rgba(16, 185, 129, 0.3); }

.col-select { width: 28px; text-align: center; }
.col-portrait { width: 44px; text-align: center; }
.col-name { min-width: 70px; font-weight: 800; }
.col-rank { min-width: 56px; }
.col-flagship { min-width: 72px; font-size: 10px; }
.num-col { text-align: center; font-family: 'Courier New', monospace; font-weight: 700; width: 38px; }
.col-total { width: 46px; }

.row-portrait { width: 32px; height: 40px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); vertical-align: middle; }
.radio-dot { display: inline-block; width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--color-border-emphasized); background: transparent; transition: all 0.2s; }
.radio-dot.checked { border-color: var(--color-green); background: var(--color-green); box-shadow: 0 0 6px rgba(16,185,129,0.5); }
.rank-badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; color: var(--color-warning); background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); }
.total-badge { display: inline-block; padding: 1px 5px; border-radius: 4px; font-size: 11px; font-weight: 900; color: var(--color-cyan); background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.2); }

/* ===== 底部操作栏 ===== */
.action-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 10px; border-top: 1px solid var(--overlay-hover); flex-shrink: 0; }
.new-action { flex-wrap: wrap; }
.selected-info { font-size: 12px; font-weight: 700; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.btn-primary {
  padding: 12px 28px; font-size: 15px; font-weight: 900; color: var(--neo-surface);
  background: linear-gradient(135deg, var(--color-cyan), var(--color-cyan)); border: none; border-radius: 10px;
  cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(6,182,212,0.35); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

/* 阵营迷你标签 */
.faction-mini { font-size: 10px; padding: 1px 7px; border-radius: 99px; font-weight: 800; }
.ally-tag { background: rgba(59,130,246,0.15); color: var(--color-alliance); border: 1px solid rgba(59,130,246,0.3); }
.empire-tag { background: rgba(239,68,68,0.15); color: var(--color-empire); border: 1px solid rgba(239,68,68,0.3); }

/* ===== 空状态 ===== */
.empty-state { text-align: center; padding: 48px 24px; color: var(--color-text-disabled); }
.empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
.empty-hint { font-size: 12px; color: var(--color-border-emphasized); margin-top: 8px; }

/* ===== 槽位卡片列表 ===== */
.list-container { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-right: 4px; }
.save-slot { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border: 1px solid transparent; transition: border 0.2s; }
.save-slot:hover { border-color: var(--color-cyan); }
.save-slot.slot-autosave { opacity: 0.7; }
.save-slot.slot-clickable { cursor: pointer; }
.save-slot.slot-clickable:hover { background: rgba(6,182,212,0.08); }
.slot-info { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
.slot-name { font-size: 14px; font-weight: 900; display: flex; align-items: center; gap: 8px; }
.slot-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.slot-admiral { font-size: 11px; color: var(--color-cyan); font-weight: 700; }
.slot-admiral.text-red { color: var(--color-empire); }
.slot-date { font-size: 11px; color: var(--color-warning); font-weight: 700; font-family: monospace; }
.slot-time { font-size: 11px; font-family: monospace; font-weight: 600; color: var(--color-text-disabled); }
.slot-arrow { font-size: 17px; color: var(--color-cyan); flex-shrink: 0; }
.autosave-tag { font-size: 10px; padding: 2px 7px; border-radius: 99px; background: var(--color-warning)22; color: var(--color-warning); font-weight: 800; border: 1px solid rgba(251,191,36,0.3); }
.slot-actions-manage { display: flex; gap: 8px; flex-shrink: 0; }
.slot-actions-manage button { padding: 7px 13px; font-size: 11px; margin: 0; }
.manage-header { display: flex; justify-content: space-between; align-items: center; }
.manage-count { font-size: 12px; color: var(--color-text-disabled); font-weight: 600; }

/* ===== 全局工具类 ===== */
.text-cyan { color: var(--color-cyan) !important; }
.text-gold { color: var(--color-warning) !important; }
.text-emerald { color: var(--color-green) !important; }
.text-red { color: var(--color-empire) !important; }
.text-ally { color: var(--color-alliance) !important; }
.text-slate-400 { color: var(--color-text-secondary); }
.text-slate-500 { color: var(--color-text-disabled); }
/* neo-* 样式由 theme/tokens.css 统一定义 */
</style>
