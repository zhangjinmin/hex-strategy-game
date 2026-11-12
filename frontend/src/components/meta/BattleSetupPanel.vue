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

        <!-- [2026-09-20] 原「战场制图」下拉（星域棋盘 / 全息战术投影 / 3D 战场 / 指挥制）已删除：
             后续玩法只有指挥制。舰艇巡览入口保留。 -->
        <div class="control-group" v-if="isSimMode">
          <button @click="showShipGallery = true" class="neo-btn btn-sm w-full mt-1 gallery-btn" title="一次性查看全部已导入战舰模型" style="margin-top:6px;color:#1fd28f;border-color:rgba(31,210,143,0.4)">
            ⬡ 舰艇模型巡览
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
        <div class="board-head">
            <h3 class="panel-title-small">前线出战序列 (最大5支舰队)</h3>
            <div class="board-actions">
              <button @click="autoDispatch('alliance')" class="neo-btn text-cyan px-2 py-1 text-xs">同盟</button>
              <button @click="autoDispatch('empire')" class="neo-btn text-red px-2 py-1 text-xs">帝国</button>
              <button @click="autoDispatch('all')" class="neo-btn text-cyan px-2 py-1 text-xs">全势力</button>
            </div>
        </div>
        
        <div class="dispatch-grid">
          <div v-for="i in 5" :key="'dispatch-'+i" class="dispatch-slot neo-inset"
               :class="{ 'slot-empty': dispatchAdmiralsList[i - 1] === undefined }"
               :data-slot="'0' + i" @click="openDispatchSelect(i - 1)">
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
                  <!-- [R5] 文案澄清：此数值是**编制强度**（战略层兵力总量 MIL_RANK_TOTAL 5000~21000），
                       与 3D 实建实体数（round(总量/K_VISUAL=100)，上限 200）差约 100× ⇒ 不可写"艘"。 -->
                  <span class="slot-ships" title="编制强度：战略层兵力总量，非屏幕上可见舰数（约 100 编制 ≈ 1 个 3D 实体）">编制 {{ getShipCount(dispatchAdmiralsList[i - 1]) }}</span>
                  <span v-for="t in (getAdmiralInfo(dispatchAdmiralsList[i - 1])?.tags || []).slice(0, 2)" :key="t" class="trait-tag">{{ tagShort(t) }}</span>
                </div>
                <!-- [W2.2] 教范阵型 + 编成明细（仅演习：战役轨 faction 无 P2 编制字段，显示会误导）。
                     玩家一眼看出"换提督 ⇒ 阵型/编成不同"。 -->
                <div v-if="isSimMode" class="slot-doctrine" :title="compDetailOf(getAdmiralInfo(dispatchAdmiralsList[i - 1]))">
                  <span class="doctrine-form">阵型 {{ formationCnOf(getAdmiralInfo(dispatchAdmiralsList[i - 1])) }}</span>
                  <span class="doctrine-comp">{{ compDetailOf(getAdmiralInfo(dispatchAdmiralsList[i - 1])) || '—' }}</span>
                </div>
              </div>
              <span class="slot-remove" @click.stop="removeDispatch(i - 1)">×</span>
            </template>
            <div v-else class="empty-body">
              <span class="empty-mark">+ 指派提督</span>
              <span class="empty-hint">点击槽位 · 从现役将领中编入舰队</span>
            </div>
          </div>
        </div>
        <div class="board-intel">
          <div class="intel-head">
            <span class="intel-title">会战态势预估</span>
            <span class="intel-rule"></span>
            <span class="intel-code">DISPOSITION · 001</span>
          </div>
          <div class="intel-metrics">
            <div class="intel-metric">
              <span class="metric-label">已编成舰队</span>
              <span class="metric-value">{{ boardSummary.count }}<i>/ 5</i></span>
              <span class="metric-note">点击空槽位，从现役将领中编入</span>
            </div>
            <div class="intel-metric">
              <span class="metric-label">我方总编制</span>
              <span class="metric-value">{{ boardSummary.total }}</span>
              <span class="metric-note">战略层兵力总量，非屏幕可见舰数</span>
            </div>
            <div class="intel-metric">
              <span class="metric-label">敌方舰队</span>
              <span class="metric-value">{{ boardSummary.enemyFleets }}<i>支</i></span>
              <span class="metric-note">敌军将领由电脑随机抽调并满编</span>
            </div>
            <div class="intel-metric">
              <span class="metric-label">交战难度</span>
              <span class="metric-value">{{ boardSummary.diffName }}</span>
              <span class="metric-note">按所选难度调整敌军规模与补给</span>
            </div>
          </div>
          <div class="intel-foot">
            <span>会战宙域 · {{ boardSummary.mapName }}</span>
            <span>敌军来源 · {{ boardSummary.enemyFaction }}</span>
            <span class="intel-hint">编成指引 · 点击槽位指派提督，或使用右上角快捷编成 · 最多 5 支舰队</span>
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
            <span @click="handleSort('ships')" class="sortable" title="编制强度（非屏幕可见舰数）">编制</span>
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
              <div class="text-xs text-gold" title="编制强度：战略层兵力总量，非屏幕上可见舰数">{{ getShipCount(adm.id) }}</div>
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
import { diffConfig, applyFactionShipRestriction } from '../../config/gameData';
import { TAG_META_MAP } from '../../config/tagConfig';
import { resolveAdmiralComposition, resolveAdmiralStyleTag } from '../../config/admiralDoctrine';
import { resolveAdmiralDoctrine } from '../../game/retreatDoctrine';
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

// [2026-09-20] 「战场制图」选择已删除：现在只有指挥制（见 settingsStore 的同名注释）。

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

// ── [W2] P2 成果可见：编制 / 阵型显示的**唯一口径**（与 BattleScene.initFactions 完全一致）──
//   风格：`resolveAdmiralStyleTag(tags, stats)`（标签优先 / 无标签用基础 stats 兜底）。
//   编制：`resolveAdmiralComposition({ faction, styleTag, milRank, admiralId })`（重点提督走覆盖表）。
//   阵型：`resolveAdmiralDoctrine([styleTag]).formation`（= `MILITARY_STYLE_PARAMS` 真源）。
const FORMATION_CN: Record<string, string> = {
  wedge: '楔形阵', line: '横阵', spindle: '纺锤阵', circle: '圆形阵', square: '方阵',
};
const styleTagOf = (adm: any) => resolveAdmiralStyleTag(adm?.tags, adm?.stats);
/** 教范阵型（中文名）：无标签且无 stats ⇒ null ⇒ 回落楔形阵（与战场默认一致） */
const formationCnOf = (adm: any) => {
  const tag = styleTagOf(adm);
  const form = tag ? resolveAdmiralDoctrine([tag]).formation : 'wedge';
  return FORMATION_CN[form] || form;
};
/** [W2.1] 演习编制：走 P2 真源（口径与战场一致，含重点提督覆盖表），**再**过一道阵营限制。
 *  `resolveAdmiralComposition` 结构上不含 `fastBattleships`（同盟禁高战已隐含满足），此处再走
 *  `applyFactionShipRestriction` 作**防御性**保证（真源将来若新增高战，限制仍生效）。 */
const simCompositionFor = (adm: any) => {
  const c = resolveAdmiralComposition({
    faction: adm?.faction || '',
    styleTag: styleTagOf(adm),
    milRank: Math.max(8, Number(adm?.rank) || 8),
    admiralId: adm?.id,
  });
  return applyFactionShipRestriction(adm?.faction || '', {
    battleships: c.battleships, fastBattleships: 0, cruisers: c.cruisers,
    destroyers: c.destroyers, carriers: c.carriers || 0, fighters: c.fighters || 0, supplies: c.supplies || 0,
  });
};
/** [W2.1] 演习编制总量 */
const simShipTotalFor = (adm: any) => totalShips(simCompositionFor(adm));
/** 编成明细（只列非零舰种）：战列×N 巡洋×N … */
const compDetailOf = (adm: any) => {
  const c = simCompositionFor(adm);
  const rows: [string, number][] = [
    ['战列', c.battleships], ['巡洋', c.cruisers], ['驱逐', c.destroyers],
    ['空母', c.carriers || 0], ['战机', c.fighters || 0], ['补给', c.supplies || 0],
  ];
  return rows.filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join(' ');
};

const getShipCount = (id: number) => {
  const adm = safeAllAdmirals.value.find((a: any) => a.id === id);
  if (!adm) return 0;
  if (isSimMode.value) {
    // [W2.1] 原走旧算法 `generateSimFullComposition`（与 P2 编成不一致）⇒ 改用 P2 真源
    return simShipTotalFor(adm);
  }
  return adm.deck ? adm.deck.filter(Boolean).length : 0;
};

/** 编成区「会战态势」摘要：全部取自现有 store / 配置真源，不是占位装饰文字。
 *  口径与模板一致：编制走 getShipCount（演习= P2 真源 simShipTotalFor），
 *  难度走 diffConfig.level，宙域走 safeMapsPool。 */
const boardSummary = computed(() => {
  const ids = dispatchAdmiralsList.value;
  const total = ids.reduce((s, id) => s + (Number(getShipCount(id)) || 0), 0);
  const map = safeMapsPool.value.find((m: any) => String(m.id) === String(selectedMapId.value));
  const diff = (diffConfig as any[]).find((d: any) => String(d.level) === String(selectedDiff.value));
  const enemyFaction = selectedFactionId.value === 'empire' ? '银河帝国'
    : selectedFactionId.value === 'alliance' ? '自由行星同盟' : '全阵营混编';
  return {
    count: ids.length,
    total,
    mapName: map?.name || '未指定',
    diffName: diff?.name || '会战',
    enemyFaction,
    enemyFleets: Number(activeFactionCount.value) || 1,
  };
});

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
    if (typeof (store as any).launchSimBattle === 'function') (store as any).launchSimBattle();
  } else {
    if (typeof (store as any).startMatchLaunch === 'function') (store as any).startMatchLaunch();
  }
};
</script>

<style scoped>
.battle-setup-container { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.setup-layout { display: flex; gap: var(--ui-4); flex: 1; overflow: hidden; min-height: 0; }

.env-settings { width: clamp(320px, 21vw, 380px); display: flex; flex-direction: column; padding: var(--ui-4); gap: var(--ui-3); flex-shrink: 0; overflow: hidden; }
/* 编成区三段式：标题 / 网格 / 会战态势。第三段用 1fr 吸收剩余高度，
   不再用伪元素造一个「只有一行字」的空大框。 */
.dispatch-board {
  flex: 1; min-width: 0; min-height: 0; overflow: hidden;
  padding: var(--ui-4) var(--ui-5);
  display: grid; grid-template-rows: auto auto minmax(180px, 1fr); gap: var(--ui-4);
  background-image: var(--ui-starmap);
}
.board-head { display: flex; justify-content: space-between; align-items: center; gap: var(--ui-3); }
.board-head .panel-title-small { flex-shrink: 0; }
.board-actions { display: flex; gap: var(--ui-1); flex-shrink: 0; }
.board-actions .neo-btn { font-size: var(--fs-label); padding: var(--ui-1) var(--ui-2); letter-spacing: 0.04em; }

.panel-title-small { font-family: var(--ui-display-font); font-size: var(--fs-h3); font-weight: var(--ui-display-weight); letter-spacing: 0.08em; color: var(--ui-ink); border-left: 3px solid var(--ui-accent); padding-left: var(--ui-2); margin: 0; flex-shrink: 0; }
.control-group { display: flex; flex-direction: column; gap: var(--ui-2); flex-shrink: 0; }
.control-group label { font-size: var(--fs-label); font-weight: 800; color: var(--color-text-secondary); }
.note-text { font-size: var(--fs-label); margin: 0; line-height: 1.4; }

.flex { display: flex; align-items: center; }
.gap-2 { gap: 8px; }
.flex-1 { flex: 1; }
.btn-icon { display: flex; align-items: center; justify-content: center; width: clamp(36px, 4vh, 44px); height: clamp(36px, 4vh, 44px); font-size: var(--fs-body); flex-shrink: 0; padding: 0; border: 1px solid var(--overlay-border); }

.select-wrapper { position: relative; display: flex; align-items: center; padding: 0; }
.select-wrapper::after { content: '▼'; position: absolute; right: 10px; color: var(--color-cyan); pointer-events: none; font-size: var(--fs-label); }
.neo-select { width: 100%; appearance: none; background: transparent; border: none; color: var(--color-text-primary); padding: var(--ui-2) var(--ui-3); font-size: var(--fs-body); font-weight: 800; outline: none; cursor: pointer; }
.neo-select option { background: var(--neo-surface); color: var(--color-text-secondary); }

.gallery-btn { min-height: var(--ui-5); padding: var(--ui-1) var(--ui-2); white-space: normal; line-height: 1.4; }
.launch-action { margin-top: auto; flex-shrink: 0; display: flex; flex-direction: column; }
.btn-launch-game { padding: var(--ui-3) 10px; font-size: var(--fs-h3); letter-spacing: 0.16em; }

/* 网格：列数由响应式决定，行数交给 grid-auto-rows 自动生成，
   这样 3 列×2 行与 2 列×3 行共用一套行高定义，不会互相覆盖。 */
.dispatch-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: clamp(200px, 23vh, 300px);
  gap: var(--ui-3); min-height: 0; align-content: start;
}
.dispatch-slot { display: flex; flex-direction: row; align-items: center; padding: var(--ui-3) var(--ui-4); position: relative; cursor: pointer; border: 1px solid var(--ui-line-strong); border-radius: var(--ui-radius); background: var(--ui-surface-2); transition: border-color var(--ui-dur-micro) var(--ui-ease), background var(--ui-dur-micro) var(--ui-ease); gap: var(--ui-4); overflow: hidden; min-height: 0; }
.dispatch-slot:hover { border-color: var(--ui-accent); background: var(--ui-surface-3); }
/* 立绘原图 160×200：上限保持 1:1，放大即糊。
   宽度按「卡片内容宽的百分比」自适应，不能按 vh 固定 —— 窄视口卡片只有 190px，
   按 vh 放到 160px 高会把右侧文字挤到不足 10px。 */
.slot-portrait { flex: 0 0 clamp(52px, 30%, 128px); width: clamp(52px, 30%, 128px); height: auto; max-height: calc(100% - 12px); aspect-ratio: 4 / 5; object-fit: cover; border-radius: var(--ui-radius); background: var(--neo-surface); border: 2px solid var(--ui-line-strong); box-shadow: var(--ui-shadow-raised); flex-shrink: 0; }
.slot-info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; flex: 1; min-width: 0; gap: clamp(4px, 0.8vh, 10px); }
.slot-name-row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--ui-2); }
.adm-slot-name { font-size: var(--fs-h2); font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slot-rank { font-size: var(--fs-label); color: var(--color-text-secondary); white-space: nowrap; flex-shrink: 0; }
.slot-stats { display: flex; flex-wrap: wrap; gap: 4px var(--ui-2); }
.slot-stats span { font-size: var(--fs-label); font-family: var(--font-family); font-weight: 700; color: var(--color-text-secondary); white-space: nowrap; }
.slot-bottom { display: flex; align-items: center; gap: var(--ui-1); flex-wrap: nowrap; }
.slot-ships { font-size: var(--fs-label); color: var(--color-warning); font-weight: 800; white-space: nowrap; }
.slot-doctrine { display: flex; align-items: baseline; gap: var(--ui-2); flex-wrap: wrap; margin-top: 2px; }
.doctrine-form { font-size: var(--fs-label); font-weight: 800; color: var(--ui-accent); white-space: nowrap; }
.doctrine-comp { font-size: var(--fs-label); color: var(--color-text-secondary); font-family: var(--font-family); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.empty-body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--ui-2); margin: auto; }
.empty-mark { font-family: var(--ui-display-font); color: var(--ui-ink-2); font-weight: 800; font-size: var(--fs-h2); letter-spacing: 0.08em; }
.empty-hint { font-size: var(--fs-label); color: var(--ui-ink-3); letter-spacing: 0.06em; }
.slot-remove { position: absolute; top: 2px; right: 6px; color: var(--color-empire); font-weight: 800; font-size: var(--fs-h3); display: none; }
.dispatch-slot:hover .slot-remove { display: block; }

/* 会战态势：真实数据，不是占位横幅 */
.board-intel { min-height: 0; display: flex; flex-direction: column; gap: var(--ui-3); padding: var(--ui-4); border: 1px solid var(--ui-line-strong); border-radius: var(--ui-radius); background: var(--ui-panel); }
.intel-head { display: flex; align-items: center; gap: var(--ui-3); flex-shrink: 0; }
.intel-title { font-family: var(--ui-display-font); font-size: var(--fs-h3); font-weight: var(--ui-display-weight); letter-spacing: 0.1em; color: var(--ui-ink); white-space: nowrap; }
.intel-rule { flex: 1; height: 1px; background: linear-gradient(to right, var(--ui-line-strong), transparent); }
.intel-code { font-size: var(--fs-caption); color: var(--ui-ink-3); letter-spacing: 0.18em; white-space: nowrap; }
.intel-metrics { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--ui-3); }
.intel-metric { display: flex; flex-direction: column; justify-content: center; gap: var(--ui-2); padding: var(--ui-3) var(--ui-4); border-left: 2px solid var(--ui-accent); border-radius: var(--ui-radius); background: var(--ui-surface-2); min-width: 0; }
.metric-label { font-size: var(--fs-label); font-weight: 800; letter-spacing: 0.08em; color: var(--ui-ink-2); }
.metric-value { font-family: var(--font-family); font-size: var(--fs-h1); font-weight: 900; line-height: 1; color: var(--ui-ink); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 第 4 格是「诸神之黄昏」这类文字，不是数字：同字号会过重，
   且在窄列会被 ellipsis 吃掉。降一档并允许折行，其余三格保持大数字。 */
.intel-metric:last-child .metric-value {
  font-size: var(--fs-h2); white-space: normal; line-height: 1.2;
  overflow: visible; text-overflow: clip; word-break: break-all;
}
.metric-value i { font-size: var(--fs-label); font-style: normal; font-weight: 700; color: var(--ui-ink-3); margin-left: 6px; }
.metric-note { font-size: var(--fs-caption); color: var(--ui-ink-3); line-height: 1.4; }
.intel-foot { display: flex; align-items: center; gap: var(--ui-5); flex-shrink: 0; padding-top: var(--ui-2); border-top: 1px solid var(--ui-line); font-size: var(--fs-label); color: var(--ui-ink-3); white-space: nowrap; }
.intel-hint { margin-left: auto; overflow: hidden; text-overflow: ellipsis; }

.selection-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--overlay-scrim); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
/* [v66] 80% 而非 80vh：vh 不参与 #game-container 的 zoom(--ui-scale) 折算（同 SaveManagerModal 注释） */
.modal-content { width: 560px; max-width: 96%; max-height: 80%; display: flex; flex-direction: column; padding: 25px; }

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
  font-size: var(--fs-label); font-weight: 800; color: var(--color-text-disabled);
}
.roster-row {
  cursor: pointer; padding: 4px; min-height: 34px; font-size: var(--fs-label);
}
.roster-row > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.roster-row .cell-name { text-align: left; padding-left: 4px; }
.roster-row .cell-portrait { text-align: left; }
.cell-name { font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 8px; }
.cell-rank { font-size: var(--fs-label); color: var(--color-text-secondary); }
.cell-stat { font-family: var(--font-family); font-weight: 800; }
.trait-cell { display: flex; flex-wrap: nowrap; gap: 3px; align-items: center; justify-content: center; overflow: hidden; }
.trait-tag { display: inline-block; padding: 0 4px; font-size: var(--fs-caption); color: #a78bfa; background: rgba(139,92,246,0.12); border-radius: var(--ui-radius); white-space: nowrap; }
.trait-more { font-size: var(--fs-caption); color: var(--color-text-disabled); }
.stat-s { color: #fbbf24 !important; }
.stat-a { color: #34d399 !important; }
.stat-b { color: #94a3b8 !important; }
.stat-c { color: #64748b !important; }
.text-xs { font-size: var(--fs-caption); }
.text-muted { color: var(--color-text-disabled); }
.mini-portrait { width: 32px; height: 40px; border-radius: var(--ui-radius); object-fit: cover; border: 1px solid var(--overlay-border); background-color: var(--neo-surface-raised); }

/* 中等宽度：改用 2 列×3 行。1050px 视口下 3 列每卡只有约 190px，
   放不下「立绘 + 姓名 + 七项数值」；2 列每卡约 290px，内容才有呼吸空间。 */
@media (max-width: 1150px) {
  .env-settings { width: clamp(280px, 28vw, 320px); padding: var(--ui-3); }
  .dispatch-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* 指标维持单行 4 列：改 2×2 会把每个指标压到约 50px，数值直接看不见。
     窄列放不下的长文案由 .intel-metric:last-child 单独降档折行解决。 */
  .intel-code { display: none; }
  .metric-note { display: none; }
  .intel-foot { flex-wrap: wrap; gap: var(--ui-2) var(--ui-4); white-space: normal; }
}
/* 窄屏 / 矮屏共用压缩：字号降一档、隐藏次要特质标签、行高统一 180px。
   1050×1033 是宽 1050 而非矮屏，只写 max-height 会漏掉这个视口。 */
@media (max-width: 1150px), (max-height: 900px) {
  .setup-layout { gap: var(--ui-2); }
  .dispatch-board { padding: var(--ui-3); gap: var(--ui-2); }
  .dispatch-grid { grid-auto-rows: minmax(0, 180px); gap: var(--ui-2); }
  .board-intel { padding: var(--ui-3); gap: var(--ui-2); }
  .intel-metrics { gap: var(--ui-2); }
  .intel-metric { padding: var(--ui-2); gap: 4px; }
  .metric-value { font-size: var(--fs-h2); }
  .metric-note { display: none; }
  .adm-slot-name, .empty-mark { font-size: var(--fs-h3); }
  .slot-rank, .slot-stats span, .slot-ships, .doctrine-form, .doctrine-comp { font-size: var(--fs-caption); }
  .slot-info { gap: 4px; }
  /* 窄卡里「编制 + 特质标签」并排会撑破 slot-info；特质属次要信息，此处收起 */
  .slot-bottom .trait-tag { display: none; }
  .intel-metric:last-child .metric-value { font-size: var(--fs-h3); }
  .slot-portrait { max-height: calc(100% - 8px); }
  .intel-foot { padding-top: 0; border-top: none; font-size: var(--fs-caption); }
  .modal-content { width: 95vw; padding: 15px; }
  .roster-hdr, .roster-row { font-size: var(--fs-label); padding: 4px; }
  .roster-hdr span { font-size: var(--fs-caption); }
  .mini-portrait { width: 24px; height: 30px; }
}
@media (max-width: 768px) {
  .setup-layout { flex-direction: column; gap: 10px; overflow: hidden; min-height: 0; }
  .env-settings { width: 100%; flex: 0 0 auto; padding: var(--ui-3); gap: var(--ui-2); }
  .dispatch-board { padding: 10px 15px; flex: 1; min-height: 0; overflow: hidden; gap: 10px; }
  .dispatch-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 160px); }
  .dispatch-slot { min-height: 0; padding: var(--ui-2); }
  .launch-action { margin-top: 10px; }
}
/* 空位卡槽：明确轮廓 + 席位编号 */
.dispatch-slot.slot-empty {
  border: 1px dashed var(--ui-line-strong);
  background: var(--ui-surface-3);
  justify-content: center;
}
.dispatch-slot.slot-empty::before {
  content: 'SLOT ' attr(data-slot);
  position: absolute; top: var(--ui-2); left: var(--ui-3);
  font-size: var(--fs-caption); font-weight: 800; letter-spacing: 0.18em;
  color: var(--ui-ink-3);
}
.dispatch-slot.slot-empty:hover { border-color: var(--ui-accent); background: rgba(var(--ui-accent-rgb), 0.08); }
/* 第六格：预备席位，让两行三列网格读起来是完整编制 */
.dispatch-grid::after {
  content: '预 备 席 位';
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--ui-line); border-radius: var(--ui-radius);
  color: var(--ui-ink-3); font-size: var(--fs-label); letter-spacing: 0.2em;
  background: repeating-linear-gradient(135deg, transparent 0 10px, rgba(255,255,255,0.012) 10px 20px);
}
</style>