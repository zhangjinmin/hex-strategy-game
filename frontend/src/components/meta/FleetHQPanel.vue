<template>
  <div class="hq-panel">
    <div class="hq-layout">
      <!-- 左栏：舰队列表 -->
      <div class="fleet-list-pane neo-card">
        <div class="pane-title">舰队序列</div>
        <button class="new-fleet-btn" @click="createFleet">+ 新建舰队</button>
        <div v-for="fle in fleetList" :key="fle.id"
             class="fleet-row" :class="{ active: selectedFleetId === fle.id }"
             @click="selectFleet(fle.id)">
          <span class="fleet-num">{{ fleetDisplayName(fle) }}</span>
          <span class="fleet-cmdr">{{ admName(fle.commanderId) }}</span>
          <span class="fleet-form" :title="formationName(fle.formation)">{{ formationIcon(fle.formation) }}</span>
        </div>
        <div v-if="fleetList.length === 0" class="list-empty">暂无舰队</div>
      </div>

      <!-- 右栏：舰队详情 -->
      <div class="fleet-detail-pane neo-card" v-if="selFleet">
        <div class="detail-head">
          <span class="pane-title">{{ fleetDisplayName(selFleet) }}</span>
          <label class="num-label">编号
            <input v-model.number="fleetNumberInput" type="number" min="1" max="99" class="num-input" :disabled="!canEdit" />
          </label>
        </div>

        <!-- 司令/副官 -->
        <div class="section">
          <div class="section-label">司令</div>
          <div class="cmdr-row">
            <img :src="getPortrait(selAdm?.imageId)" class="cmdr-portrait" />
            <div class="cmdr-info">
              <div class="cmdr-name">{{ selAdm?.name || '未任命' }}</div>
              <div class="cmdr-rank">{{ selAdm?.rankName || '—' }}</div>
            </div>
            <button @click="openCmdrSelect" class="neo-btn btn-sm text-cyan" :disabled="!canEdit">更换</button>
          </div>
        </div>

        <div class="section">
          <div class="section-label">副官（参谋团 · 最多5人）</div>
          <div class="staff-row">
            <div v-for="i in 5" :key="'s'+i" class="staff-slot"
                 @click="openStaffSelect(i - 1)" :class="{ 'has-staff': selAdm?.staffs?.[i-1] }">
              <img v-if="selAdm?.staffs?.[i-1]" :src="getPortrait(staffInfo(selAdm.staffs[i-1])?.imageId)" class="staff-img" />
              <span v-else class="staff-empty">+</span>
              <span v-if="selAdm?.staffs?.[i-1]" class="staff-name">{{ staffInfo(selAdm.staffs[i-1])?.name }}</span>
            </div>
          </div>
        </div>

        <!-- 舰种配置（+ = 造船订单·消耗国库，− = 退役裁撤） -->
        <div class="section">
          <div class="section-label">舰船配置 <span class="build-hint">+ 建造(花钱) / − 退役</span></div>
          <div v-for="st in shipTypes" :key="st.key" class="ship-row">
            <span class="ship-label">{{ st.label }}</span>
            <div class="ship-ctrl">
              <button @click="adjustShips(st.key, -st.step)" class="btn-qty" :disabled="!canEdit" title="退役裁撤">-</button>
              <span class="ship-count">{{ compCount(st.key) }}</span>
              <button @click="adjustShips(st.key, st.step)" class="btn-qty btn-build" :disabled="!canEdit" title="下造船订单（需停靠首都/要塞，消耗国库）">+</button>
            </div>
          </div>
          <div class="ship-total">总舰数：{{ totalShips }}</div>
          <!-- 在建订单 -->
          <div v-if="fleetConstruction.length" class="build-queue">
            <div class="bq-title">在建订单</div>
            <div v-for="item in fleetConstruction" :key="item.nodeId + '_' + item.shipType" class="bq-row">
              <span>{{ shipTypeName(item.shipType) }} ×{{ item.count }}</span>
              <span class="bq-progress">{{ Math.floor(item.progress) }}%</span>
            </div>
          </div>
        </div>

        <!-- 阵型 + 一键布阵 -->
        <div class="section">
          <div class="section-label">战术阵型</div>
          <div class="form-row">
            <select v-model="currentFormation" class="form-select" :disabled="!canEdit">
              <option v-for="f in formationList" :key="f.id" :value="f.id">{{ f.icon }} {{ f.name }} — {{ f.desc }}</option>
            </select>
            <button @click="applyFormationLayout" class="neo-btn btn-sm text-cyan" :disabled="!canEdit">一键布阵</button>
          </div>
          <!-- 7x7 棋盘 -->
          <div class="chess-board">
            <div v-for="cell in boardCells" :key="cell.x + '-' + cell.y"
                 class="board-cell" :class="{ 'cell-dark': (cell.x + cell.y) % 2 === 0, 'cell-pick': poolSelected && !getSlot(cell.x, cell.y) }"
                 @click="handleCell(cell.x, cell.y)">
              <div v-if="getSlot(cell.x, cell.y)" class="cell-ship" :class="'ship-' + getSlot(cell.x, cell.y)">
                {{ shipShort(getSlot(cell.x, cell.y)!) }}
              </div>
            </div>
          </div>
          <div class="ship-pool">
            <button v-for="st in shipTypes" :key="'p'+st.key" class="pool-btn"
                    :class="{ active: poolSelected === st.key }"
                    @click="poolSelected = poolSelected === st.key ? null : st.key" :disabled="!canEdit">
              {{ st.label }}
            </button>
            <span class="pool-tip" v-if="canEdit">先选舰种，再点击棋盘放置</span>
          </div>
        </div>

        <div class="detail-actions">
          <button @click="save" class="neo-btn btn-sm text-cyan" :disabled="!canEdit">保存编成</button>
          <span v-if="!canEdit" class="lock-tip">当前职务无权编辑此舰队</span>
        </div>
      </div>

      <!-- 未选中 -->
      <div class="fleet-detail-pane empty-detail neo-card" v-else>
        ← 选择左侧舰队查看编成，或新建舰队
      </div>
    </div>

    <!-- 司令选择浮层 -->
    <div v-if="showCmdrSelect" class="modal-overlay" @click.self="showCmdrSelect = false">
      <div class="select-modal">
        <div class="modal-title">更换司令</div>
        <button v-for="a in freeCommanders" :key="a.id" class="cmdr-option"
                @click="assignCmdr(a.id)">
          {{ a.name }} · {{ a.rankName }}
        </button>
        <button @click="showCmdrSelect = false" class="neo-btn btn-sm text-slate-400 mt-2">取消</button>
      </div>
    </div>

    <!-- 副官选择浮层 -->
    <div v-if="staffSelectIdx !== null" class="modal-overlay" @click.self="staffSelectIdx = null">
      <div class="select-modal">
        <div class="modal-title">委任副官（槽位 {{ staffSelectIdx + 1 }}）</div>
        <button v-for="a in freeStaff" :key="a.id" class="cmdr-option" @click="assignStaff(a.id)">
          {{ a.name }} · {{ a.rankName }}
        </button>
        <button @click="staffSelectIdx = null" class="neo-btn btn-sm text-slate-400 mt-2">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGameStore, getPortrait } from '../../store/gameStore';
import { useFleetStore } from '../../store/fleetStore';
import { FORMATIONS, DEFAULT_FORMATION, layoutFormationSlots, type FormationType } from '../../config/formations';
import { canEditFleet } from '../../config/roleConfig';
import type { ShipType } from '../../types/game';

const store = useGameStore() as any;
const fleetStore = useFleetStore();

// 编成 key（复数）→ 建造用 ShipType（单数）
const compKeyToShipType: Record<string, ShipType> = {
  battleships: 'battleship',
  fastBattleships: 'fast_battleship',
  cruisers: 'cruiser',
  destroyers: 'destroyer',
  carriers: 'carrier',
  fighters: 'fighter',
};

const selectedFleetId = ref<number | null>(null);
const currentFormation = ref<string>(DEFAULT_FORMATION);
const poolSelected = ref<string | null>(null);
const showCmdrSelect = ref(false);
const staffSelectIdx = ref<number | null>(null);
const fleetNumberInput = ref(1);

const boardCells = Array.from({ length: 49 }, (_, i) => ({ x: i % 7, y: Math.floor(i / 7) }));

const formationList = Object.entries(FORMATIONS).map(([id, f]) => ({ id, name: f.name, desc: f.description, icon: f.icon }));
const formationMap = Object.fromEntries(formationList.map(f => [f.id, f]));

const shipTypes = [
  { key: 'battleships', label: '战列舰', step: 1000 },
  { key: 'fastBattleships', label: '高速战列舰', step: 500 },
  { key: 'cruisers', label: '巡洋舰', step: 1000 },
  { key: 'destroyers', label: '驱逐舰', step: 2000 },
  { key: 'carriers', label: '航母', step: 500 },
  { key: 'fighters', label: '战斗机', step: 2000 },
];

// 只显示玩家阵营的舰队（修复：同盟看不到帝国舰队）
const fleetList = computed(() => {
  const all = (store.strategicFleets || []) as any[];
  const pf = playerAdm.value?.faction;
  if (!pf) return all;
  const factionId = pf === 'alliance' ? 1 : 2;
  return all.filter((f: any) => f.factionId === factionId);
});
const selFleet = computed(() => fleetList.value.find((f: any) => f.id === selectedFleetId.value) || null);
const selAdm = computed(() => selFleet.value ? (store.allAdmirals || []).find((a: any) => a.id === selFleet.value.commanderId) : null);
const playerAdm = computed(() => (store.allAdmirals || []).find((a: any) => a.id === store.playerAdmiralId));

const canEdit = computed(() => {
  if (!selFleet.value || !playerAdm.value) return false;
  return canEditFleet(playerAdm.value, selFleet.value);
});

const freeCommanders = computed(() => {
  const all = (store.allAdmirals || []) as any[];
  const playerFaction = playerAdm.value?.faction;
  return all.filter((a: any) => a.faction === playerFaction && !fleetList.value.some((f: any) => f.commanderId === a.id));
});

const freeStaff = computed(() => {
  const all = (store.allAdmirals || []) as any[];
  const playerFaction = playerAdm.value?.faction;
  const occupied = new Set<number>([selFleet.value?.commanderId, ...(selAdm.value?.staffs || [])]);
  return all.filter((a: any) => a.faction === playerFaction && !occupied.has(a.id));
});

watch(selFleet, (f) => {
  if (f) {
    currentFormation.value = f.formation || DEFAULT_FORMATION;
    fleetNumberInput.value = f.fleetNumber || 1;
  }
}, { immediate: true });

function admName(id: number): string { return (store.allAdmirals || []).find((a: any) => a.id === id)?.name || '无人'; }
function staffInfo(id: number): any { return (store.allAdmirals || []).find((a: any) => a.id === id); }
function formationIcon(fid: string): string { return formationMap[fid]?.icon || '—'; }
function formationName(fid: string): string { return formationMap[fid]?.name || ''; }
function fleetDisplayName(f: any): string {
  const fn = f.fleetNumber;
  return fn ? `第${fn}舰队` : `舰队#${f.id}`;
}
function compCount(key: string): number {
  const c = selFleet.value?.composition;
  return c ? (c[key] || 0).toLocaleString() : '0';
}
const totalShips = computed(() => {
  const c = selFleet.value?.composition;
  return c ? Object.values(c).reduce((s: number, v: any) => s + (v || 0), 0) : 0;
});

// 当前舰队的在建订单（直接过滤建造队列，规避 pinia getter 解包类型差异）
const fleetConstruction = computed(() => {
  if (!selFleet.value) return [];
  const queue = (fleetStore as any).constructionQueue || [];
  return queue.filter((c: any) => c.fleetId === selFleet.value.id);
});
function shipTypeName(t: string): string {
  const m: Record<string, string> = {
    battleship: '标准战舰', fast_battleship: '高速战舰', cruiser: '巡航舰',
    destroyer: '驱逐舰', carrier: '标准空母', fighter: '舰载机',
  };
  return m[t] || t;
}

// 棋盘槽位（tacticalSlots）
function getSlot(x: number, y: number): string | null {
  const slots = (selFleet.value as any)?.tacticalSlots || [];
  const s = slots.find((s: any) => s.x === x && s.y === y);
  return s ? s.type : null;
}
function handleCell(x: number, y: number) {
  if (!canEdit.value || !selFleet.value) return;
  const slots = [...((selFleet.value as any).tacticalSlots || [])];
  const idx = slots.findIndex(s => s.x === x && s.y === y);
  if (idx >= 0) slots.splice(idx, 1);
  else if (poolSelected.value) { slots.push({ x, y, type: poolSelected.value, count: 100 }); poolSelected.value = null; }
  (selFleet.value as any).tacticalSlots = slots;
}
function shipShort(t: string): string {
  const m: Record<string, string> = { battleships: '战', fastBattleships: '高战', cruisers: '巡', destroyers: '驱', carriers: '航', fighters: '战斗机' };
  return m[t] || '?';
}

function adjustShips(key: string, delta: number) {
  if (!selFleet.value || !canEdit.value) return;
  const shipType = compKeyToShipType[key];
  if (!shipType) return;

  if (delta > 0) {
    // 增兵 = 下造船订单：扣国库、需停靠在首都/要塞船坞、受军衔容量限制
    const nodeId = (selFleet.value as any).currentNodeId;
    if (nodeId === undefined || nodeId === null || nodeId < 0) {
      store.triggerToast?.('舰队正在跃迁途中，无法补充舰船。请先抵达己方星域。');
      return;
    }
    const r = fleetStore.buildShips(
      selFleet.value.id,
      nodeId,
      selFleet.value.factionId,
      shipType,
      delta
    );
    store.triggerToast?.(r.message);
  } else {
    // 减兵 = 退役裁撤：直接削减编成（无退款，避免刷钱）
    const c = { ...(selFleet.value.composition || {}) };
    c[key] = Math.max(0, (c[key] || 0) + delta);
    selFleet.value.composition = c;
    store.triggerToast?.(`已退役 ${Math.abs(delta)} 艘舰船。`);
  }
}

function applyFormationLayout() {
  if (!selFleet.value || !canEdit.value) return;
  const slots = layoutFormationSlots(currentFormation.value as FormationType, selFleet.value.composition);
  (selFleet.value as any).tacticalSlots = slots;
  store.triggerToast?.(`已按${formationName(currentFormation.value)}布阵`);
}

function selectFleet(id: number) { selectedFleetId.value = id; }
function createFleet() {
  if (!playerAdm.value) return;
  const r = store.createFleet?.(playerAdm.value.id);
  if (r?.success) selectedFleetId.value = fleetList.value[fleetList.value.length - 1].id;
}
function openCmdrSelect() { showCmdrSelect.value = true; }
function assignCmdr(id: number) {
  if (!selFleet.value) return;
  selFleet.value.commanderId = id;
  const adm = (store.allAdmirals || []).find((a: any) => a.id === id);
  if (adm) adm.assignedFleetId = selFleet.value.id;
  showCmdrSelect.value = false;
  store.triggerToast?.(`${adm?.name} 已就任第${fleetDisplayName(selFleet.value)}司令`);
}
function openStaffSelect(idx: number) {
  if (!canEdit.value) return;
  staffSelectIdx.value = idx;
}
function assignStaff(id: number) {
  if (!selAdm.value || staffSelectIdx.value === null) return;
  if (!selAdm.value.staffs) selAdm.value.staffs = [];
  selAdm.value.staffs[staffSelectIdx.value] = id;
  staffSelectIdx.value = null;
}
function save() {
  if (!selFleet.value || !canEdit.value) return;
  selFleet.value.formation = currentFormation.value;
  selFleet.value.fleetNumber = fleetNumberInput.value;
  store.triggerToast?.('舰队编成已保存');
}
</script>

<style scoped>
.hq-panel { height: 100%; overflow: hidden; }
.hq-layout { display: flex; gap: 10px; height: 100%; }
.fleet-list-pane { width: 210px; flex-shrink: 0; padding: 10px; overflow-y: auto; }
.fleet-detail-pane { flex: 1; padding: 10px; overflow-y: auto; min-width: 0; }
.pane-title { font-size: 13px; font-weight: 800; color: var(--color-cyan); margin-bottom: 8px; display: block; }
.new-fleet-btn { width: 100%; padding: 6px; border: 1px dashed var(--color-cyan); background: transparent; color: var(--color-cyan); font-size: 12px; border-radius: 3px; cursor: pointer; margin-bottom: 8px; }
.new-fleet-btn:hover { background: rgba(6,182,212,0.1); }
.fleet-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; font-size: 12px; color: var(--color-text-secondary); }
.fleet-row:hover, .fleet-row.active { background: rgba(6,182,212,0.08); border-color: var(--color-cyan); color: var(--color-text-primary); }
.fleet-num { font-weight: 700; color: var(--color-text-primary); min-width: 58px; }
.fleet-cmdr { flex: 1; color: var(--color-gold); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fleet-form { font-size: 13px; color: var(--color-cyan); font-weight: 700; }
.list-empty { padding: 14px; text-align: center; color: var(--color-text-disabled); font-size: 11px; }
.empty-detail { display: flex; align-items: center; justify-content: center; color: var(--color-text-disabled); font-size: 12px; }

.detail-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.num-label { font-size: 11px; color: var(--color-text-disabled); display: flex; align-items: center; gap: 4px; }
.num-input { width: 46px; padding: 2px 4px; background: var(--neo-body); border: 1px solid var(--color-border); color: var(--color-text-primary); border-radius: 2px; font-size: 12px; }
.section { margin-bottom: 12px; }
.section-label { font-size: 11px; font-weight: 700; color: var(--color-text-disabled); margin-bottom: 5px; }

.cmdr-row { display: flex; align-items: center; gap: 8px; }
.cmdr-portrait { width: 42px; height: 52px; object-fit: cover; border: 1px solid var(--color-border); border-radius: 2px; }
.cmdr-info { flex: 1; }
.cmdr-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.cmdr-rank { font-size: 11px; color: var(--color-text-disabled); }

.staff-row { display: flex; gap: 6px; flex-wrap: wrap; }
.staff-slot { width: 72px; padding: 4px; border: 1px dashed var(--color-border); border-radius: 3px; text-align: center; cursor: pointer; }
.staff-slot.has-staff { border-style: solid; border-color: var(--color-cyan); }
.staff-img { width: 30px; height: 38px; object-fit: cover; border-radius: 2px; display: block; margin: 0 auto; }
.staff-empty { display: block; font-size: 18px; color: var(--color-text-disabled); padding: 6px 0; }
.staff-name { display: block; font-size: 9px; color: var(--color-cyan); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ship-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(6,182,212,0.05); }
.ship-label { font-size: 12px; color: var(--color-text-primary); }
.ship-ctrl { display: flex; align-items: center; gap: 8px; }
.ship-count { font-size: 12px; font-weight: 800; color: var(--color-cyan); min-width: 58px; text-align: right; }
.btn-qty { width: 22px; height: 22px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-primary); cursor: pointer; border-radius: 2px; font-size: 13px; }
.btn-qty:hover:not(:disabled) { background: rgba(6,182,212,0.1); }
.btn-qty:disabled { opacity: 0.3; cursor: not-allowed; }
.ship-total { font-size: 11px; color: var(--color-text-disabled); margin-top: 4px; text-align: right; }
.build-hint { font-size: 10px; color: var(--color-text-disabled); font-weight: 400; margin-left: 6px; }
.btn-build { border-color: var(--color-gold, #f59e0b); color: var(--color-gold, #f59e0b); }
.btn-build:hover:not(:disabled) { background: rgba(245,158,11,0.12); }
.build-queue { margin-top: 8px; padding: 6px 8px; border: 1px solid rgba(245,158,11,0.2); border-radius: 3px; background: rgba(245,158,11,0.04); }
.bq-title { font-size: 10px; color: var(--color-gold, #f59e0b); font-weight: 700; margin-bottom: 4px; }
.bq-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-text-secondary); padding: 2px 0; }
.bq-progress { color: var(--color-cyan); font-weight: 700; }

.form-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.form-select { flex: 1; padding: 5px; background: var(--neo-body); border: 1px solid var(--color-border); color: var(--color-text-primary); border-radius: 3px; font-size: 11px; }
.form-select:disabled { opacity: 0.4; }

.chess-board { display: grid; grid-template-columns: repeat(7, 28px); grid-template-rows: repeat(7, 28px); gap: 2px; margin-bottom: 6px; }
.board-cell { width: 28px; height: 28px; border: 1px solid var(--color-border); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 9px; }
.cell-dark { background: rgba(6,182,212,0.04); }
.cell-pick:hover { border-color: var(--color-cyan); background: rgba(6,182,212,0.12); }
.cell-ship { font-weight: 700; padding: 1px 2px; border-radius: 2px; }
.ship-battleships { background: rgba(239,68,68,0.18); color: #ef4444; }
.ship-fastBattleships { background: rgba(249,115,22,0.18); color: #f97316; }
.ship-cruisers { background: rgba(245,158,11,0.18); color: #f59e0b; }
.ship-destroyers { background: rgba(6,182,212,0.18); color: #06b6d4; }
.ship-carriers { background: rgba(34,197,94,0.18); color: #22c55e; }
.ship-fighters { background: rgba(148,163,184,0.2); color: #94a3b8; }

.ship-pool { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.pool-btn { padding: 2px 6px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); font-size: 10px; border-radius: 2px; cursor: pointer; }
.pool-btn.active { border-color: var(--color-cyan); color: var(--color-cyan); background: rgba(6,182,212,0.1); }
.pool-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.pool-tip { font-size: 9px; color: var(--color-text-disabled); margin-left: 4px; }

.detail-actions { display: flex; align-items: center; gap: 10px; }
.lock-tip { font-size: 10px; color: var(--color-text-disabled); }

.modal-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }
.select-modal { width: min(320px, 80vw); max-height: 60vh; overflow-y: auto; background: var(--neo-surface); border: 1px solid var(--color-border); border-radius: 6px; padding: 14px; }
.modal-title { font-size: 13px; font-weight: 800; color: var(--color-cyan); margin-bottom: 8px; }
.cmdr-option { display: block; width: 100%; text-align: left; padding: 6px; border: none; background: transparent; color: var(--color-text-primary); font-size: 12px; cursor: pointer; border-radius: 3px; }
.cmdr-option:hover { background: rgba(6,182,212,0.1); }
</style>
